import axios from 'axios';
import {
  getAmazonAuthContext,
  updateAmazonAuthContextTokens,
  type AmazonUserTokens,
} from '../remote/amazon-auth-context.js';
import { getActiveOAuthStore } from '../remote/oauth-store.js';

const DEFAULT_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const DEFAULT_PRE_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface TokenManagerConfig {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  scope?: string;
  tokenEndpoint?: string;
  preExpiryBufferMs?: number;
}

export interface LWAValidationResult {
  accessToken: string;
  expiresAt: Date;
  scope?: string;
  tokenType: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  scope?: string;
  tokenType: string;
}

interface LWATokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class TokenManager {
  private cache: TokenCache | null = null;
  private refreshPromise: Promise<LWAValidationResult> | null = null;
  private readonly tokenEndpoint: string;
  private readonly preExpiryBufferMs: number;

  constructor(private readonly config: TokenManagerConfig) {
    this.tokenEndpoint = config.tokenEndpoint ?? DEFAULT_TOKEN_URL;
    this.preExpiryBufferMs = config.preExpiryBufferMs ?? DEFAULT_PRE_EXPIRY_BUFFER_MS;
  }

  async getToken(): Promise<LWAValidationResult> {
    const session = getAmazonAuthContext();
    if (session) {
      return this.getSessionToken(session.mcpAccessToken, session.tokens);
    }

    if (this.isTokenValid()) {
      return this.toValidationResult(this.cache!);
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshConfiguredToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async getAccessToken(): Promise<string> {
    const result = await this.getToken();
    return result.accessToken;
  }

  invalidateToken(): void {
    this.clearCache();
  }

  isTokenExpired(): boolean {
    const session = getAmazonAuthContext();
    if (session) {
      const tokens = this.currentSessionTokens(session.mcpAccessToken, session.tokens);
      return Date.now() >= tokens.expiresAt - this.preExpiryBufferMs;
    }
    return !this.isTokenValid();
  }

  getTokenExpiry(): Date | null {
    const session = getAmazonAuthContext();
    if (session) {
      const tokens = this.currentSessionTokens(session.mcpAccessToken, session.tokens);
      return new Date(tokens.expiresAt);
    }
    if (!this.cache) {
      return null;
    }
    return new Date(this.cache.expiresAt);
  }

  clearCache(): void {
    const session = getAmazonAuthContext();
    if (session) {
      const tokens = {
        ...this.currentSessionTokens(session.mcpAccessToken, session.tokens),
        expiresAt: 0,
      };
      this.persistSessionTokens(session.mcpAccessToken, tokens);
      return;
    }
    this.cache = null;
  }

  private currentSessionTokens(mcpAccessToken: string, fallback: AmazonUserTokens): AmazonUserTokens {
    return getActiveOAuthStore()?.getAccessToken(mcpAccessToken)?.lwaTokens ?? fallback;
  }

  private persistSessionTokens(mcpAccessToken: string, tokens: AmazonUserTokens): void {
    updateAmazonAuthContextTokens(tokens);
    getActiveOAuthStore()?.updateLwaTokens(mcpAccessToken, tokens);
  }

  private async getSessionToken(
    mcpAccessToken: string,
    fallback: AmazonUserTokens
  ): Promise<LWAValidationResult> {
    const tokens = this.currentSessionTokens(mcpAccessToken, fallback);
    if (Date.now() < tokens.expiresAt - this.preExpiryBufferMs) {
      return {
        accessToken: tokens.accessToken,
        expiresAt: new Date(tokens.expiresAt),
        scope: tokens.scope,
        tokenType: tokens.tokenType,
      };
    }

    const refreshed = await this.refreshWithToken(tokens.refreshToken);
    const updated: AmazonUserTokens = {
      ...tokens,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.expiresAt.getTime(),
      tokenType: refreshed.tokenType,
      scope: refreshed.scope ?? tokens.scope,
    };
    this.persistSessionTokens(mcpAccessToken, updated);
    return refreshed.result;
  }

  private isTokenValid(): boolean {
    if (!this.cache) {
      return false;
    }
    return Date.now() < this.cache.expiresAt - this.preExpiryBufferMs;
  }

  private async refreshConfiguredToken(): Promise<LWAValidationResult> {
    if (!this.config.refreshToken) {
      throw new Error(
        'No Amazon credentials available. Complete Login with Amazon, or set a refresh token for stdio mode.'
      );
    }
    const refreshed = await this.refreshWithToken(this.config.refreshToken);
    this.cache = {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt.getTime(),
      scope: refreshed.scope,
      tokenType: refreshed.tokenType,
    };
    return refreshed.result;
  }

  private async refreshWithToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
    scope?: string;
    tokenType: string;
    result: LWAValidationResult;
  }> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (this.config.scope) {
      params.set('scope', this.config.scope);
    }

    try {
      const response = await axios.post<LWATokenResponse>(this.tokenEndpoint, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { access_token, refresh_token, expires_in, scope, token_type } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);
      const result: LWAValidationResult = {
        accessToken: access_token,
        expiresAt,
        scope,
        tokenType: token_type,
      };

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        scope,
        tokenType: token_type,
        result,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as
          | { error?: string; error_description?: string }
          | undefined;
        const message = data?.error_description || error.message;
        throw new Error(`Failed to refresh LWA access token: ${message}`);
      }
      throw error;
    }
  }

  private toValidationResult(cache: TokenCache): LWAValidationResult {
    return {
      accessToken: cache.accessToken,
      expiresAt: new Date(cache.expiresAt),
      scope: cache.scope,
      tokenType: cache.tokenType,
    };
  }
}
