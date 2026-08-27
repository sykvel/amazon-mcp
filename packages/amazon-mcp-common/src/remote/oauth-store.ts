import { randomBytes, randomUUID } from 'node:crypto';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AmazonUserTokens } from './amazon-auth-context.js';

const PENDING_TTL_MS = 10 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PendingAuthorization {
  id: string;
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  createdAt: number;
  sellerId?: string;
}

export interface AuthorizationCodeRecord {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  lwaTokens: AmazonUserTokens;
  createdAt: number;
}

export interface AccessTokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
  refreshToken: string;
  lwaTokens: AmazonUserTokens;
}

export interface RefreshTokenRecord {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
  lwaTokens: AmazonUserTokens;
}

export class InMemoryOAuthStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, AuthorizationCodeRecord>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(
    client: OAuthClientInformationFull
  ): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    return client;
  }

  createPendingAuthorization(
    client: OAuthClientInformationFull,
    params: AuthorizationParams
  ): PendingAuthorization {
    this.pruneExpired();
    const pending: PendingAuthorization = {
      id: randomUUID(),
      client,
      params,
      createdAt: Date.now(),
    };
    this.pending.set(pending.id, pending);
    return pending;
  }

  getPendingAuthorization(id: string): PendingAuthorization | undefined {
    const pending = this.pending.get(id);
    if (!pending) {
      return undefined;
    }
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      this.pending.delete(id);
      return undefined;
    }
    return pending;
  }

  updatePendingAuthorization(pending: PendingAuthorization): void {
    this.pending.set(pending.id, pending);
  }

  takePendingAuthorization(id: string): PendingAuthorization | undefined {
    const pending = this.getPendingAuthorization(id);
    if (pending) {
      this.pending.delete(id);
    }
    return pending;
  }

  createAuthorizationCode(record: AuthorizationCodeRecord): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, record);
    return code;
  }

  getAuthorizationCode(code: string): AuthorizationCodeRecord | undefined {
    const record = this.codes.get(code);
    if (!record) {
      return undefined;
    }
    if (Date.now() - record.createdAt > AUTH_CODE_TTL_MS) {
      this.codes.delete(code);
      return undefined;
    }
    return record;
  }

  takeAuthorizationCode(code: string): AuthorizationCodeRecord | undefined {
    const record = this.getAuthorizationCode(code);
    if (record) {
      this.codes.delete(code);
    }
    return record;
  }

  issueTokens(input: {
    clientId: string;
    scopes: string[];
    resource?: URL;
    lwaTokens: AmazonUserTokens;
  }): { accessToken: string; refreshToken: string; expiresIn: number } {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const now = Date.now();

    this.accessTokens.set(accessToken, {
      clientId: input.clientId,
      scopes: input.scopes,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
      resource: input.resource,
      refreshToken,
      lwaTokens: input.lwaTokens,
    });

    this.refreshTokens.set(refreshToken, {
      clientId: input.clientId,
      scopes: input.scopes,
      expiresAt: now + REFRESH_TOKEN_TTL_MS,
      resource: input.resource,
      lwaTokens: input.lwaTokens,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    };
  }

  getAccessToken(token: string): AccessTokenRecord | undefined {
    const record = this.accessTokens.get(token);
    if (!record) {
      return undefined;
    }
    if (record.expiresAt <= Date.now()) {
      this.accessTokens.delete(token);
      return undefined;
    }
    return record;
  }

  getRefreshToken(token: string): RefreshTokenRecord | undefined {
    const record = this.refreshTokens.get(token);
    if (!record) {
      return undefined;
    }
    if (record.expiresAt <= Date.now()) {
      this.refreshTokens.delete(token);
      return undefined;
    }
    return record;
  }

  updateLwaTokens(mcpAccessToken: string, lwaTokens: AmazonUserTokens): void {
    const access = this.accessTokens.get(mcpAccessToken);
    if (access) {
      access.lwaTokens = lwaTokens;
      const refresh = this.refreshTokens.get(access.refreshToken);
      if (refresh) {
        refresh.lwaTokens = lwaTokens;
      }
    }
  }

  revokeToken(token: string): void {
    const access = this.accessTokens.get(token);
    if (access) {
      this.accessTokens.delete(token);
      this.refreshTokens.delete(access.refreshToken);
      return;
    }

    const refresh = this.refreshTokens.get(token);
    if (refresh) {
      this.refreshTokens.delete(token);
      for (const [accessToken, record] of this.accessTokens) {
        if (record.refreshToken === token) {
          this.accessTokens.delete(accessToken);
        }
      }
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, pending] of this.pending) {
      if (now - pending.createdAt > PENDING_TTL_MS) {
        this.pending.delete(id);
      }
    }
    for (const [code, record] of this.codes) {
      if (now - record.createdAt > AUTH_CODE_TTL_MS) {
        this.codes.delete(code);
      }
    }
  }
}

let activeOAuthStore: InMemoryOAuthStore | undefined;

export function setActiveOAuthStore(store: InMemoryOAuthStore | undefined): void {
  activeOAuthStore = store;
}

export function getActiveOAuthStore(): InMemoryOAuthStore | undefined {
  return activeOAuthStore;
}
