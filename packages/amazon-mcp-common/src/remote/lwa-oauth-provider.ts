import axios from 'axios';
import type { Request, Response } from 'express';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AmazonUserTokens } from './amazon-auth-context.js';
import { InMemoryOAuthStore } from './oauth-store.js';

const DEFAULT_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const DEFAULT_LWA_AUTHORIZE_URL = 'https://www.amazon.com/ap/oa';
const PENDING_COOKIE = 'amazon_oauth_pending';

export type AmazonConsentMode = 'lwa' | 'seller-central';

export interface AmazonOAuthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  redirectUri: string;
  consentMode: AmazonConsentMode;
  scopes: string[];
  applicationId?: string;
  includeVersionBeta?: boolean;
  enrichUserTokens?: (tokens: AmazonUserTokens) => Promise<AmazonUserTokens>;
}

interface LWATokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class AmazonFederatedOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: InMemoryOAuthStore;
  private readonly tokenUrl: string;
  private readonly authorizationUrl: string;

  constructor(
    private readonly config: AmazonOAuthConfig,
    store: InMemoryOAuthStore = new InMemoryOAuthStore()
  ) {
    this.clientsStore = store;
    this.tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.authorizationUrl =
      config.authorizationUrl ??
      (config.consentMode === 'seller-central'
        ? 'https://sellercentral.amazon.com/apps/authorize/consent'
        : DEFAULT_LWA_AUTHORIZE_URL);
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const pending = this.clientsStore.createPendingAuthorization(client, params);
    setPendingCookie(res, pending.id, this.config.redirectUri);

    res.redirect(this.buildAmazonAuthorizationUrl(pending.id));
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const record = this.clientsStore.getAuthorizationCode(authorizationCode);
    if (!record) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return record.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const record = this.clientsStore.takeAuthorizationCode(authorizationCode);
    if (!record) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    if (record.client.client_id !== client.client_id) {
      throw new InvalidGrantError('Authorization code was not issued to this client');
    }

    const issued = this.clientsStore.issueTokens({
      clientId: client.client_id,
      scopes: record.params.scopes ?? [],
      resource: record.params.resource,
      lwaTokens: record.lwaTokens,
    });

    return {
      access_token: issued.accessToken,
      token_type: 'bearer',
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: issuedScopes(record.params.scopes),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const record = this.clientsStore.getRefreshToken(refreshToken);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token');
    }

    this.clientsStore.revokeToken(refreshToken);

    const issued = this.clientsStore.issueTokens({
      clientId: client.client_id,
      scopes: scopes ?? record.scopes,
      resource: resource ?? record.resource,
      lwaTokens: record.lwaTokens,
    });

    return {
      access_token: issued.accessToken,
      token_type: 'bearer',
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: issuedScopes(scopes ?? record.scopes),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = this.clientsStore.getAccessToken(token);
    if (!record) {
      throw new InvalidTokenError('Invalid or expired token');
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: record.resource,
      extra: {
        sellerId: record.lwaTokens.sellerId,
        profileId: record.lwaTokens.profileId,
        marketplaceId: record.lwaTokens.marketplaceId,
      },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    this.clientsStore.revokeToken(request.token);
  }

  async handleAmazonCallback(req: Request, res: Response): Promise<void> {
    const query = asQuery(req.query);
    const pendingId = query.state ?? readPendingCookie(req);

    if (query.error) {
      this.redirectPendingError(
        res,
        pendingId,
        query.error,
        query.error_description ?? 'Amazon authorization failed'
      );
      return;
    }

    if (query.amazon_callback_uri && !query.spapi_oauth_code && !query.code) {
      await this.handleSellerCentralHandshake(req, res, query, pendingId);
      return;
    }

    const amazonCode = query.spapi_oauth_code ?? query.code;
    if (!amazonCode || !pendingId) {
      res.status(400).type('html').send(errorPage('Missing authorization code from Amazon.'));
      return;
    }

    const pending = this.clientsStore.takePendingAuthorization(pendingId);
    if (!pending) {
      res.status(400).type('html').send(errorPage('Authorization session expired. Please try again.'));
      return;
    }

    try {
      const lwaTokens = await this.exchangeAmazonCode(amazonCode);
      if (query.selling_partner_id && !lwaTokens.sellerId) {
        lwaTokens.sellerId = query.selling_partner_id;
      }
      if (pending.sellerId && !lwaTokens.sellerId) {
        lwaTokens.sellerId = pending.sellerId;
      }

      const enriched = this.config.enrichUserTokens
        ? await this.config.enrichUserTokens(lwaTokens)
        : lwaTokens;

      const code = this.clientsStore.createAuthorizationCode({
        client: pending.client,
        params: pending.params,
        lwaTokens: enriched,
        createdAt: Date.now(),
      });

      const target = new URL(pending.params.redirectUri);
      target.searchParams.set('code', code);
      if (pending.params.state) {
        target.searchParams.set('state', pending.params.state);
      }
      clearPendingCookie(res, this.config.redirectUri);
      res.redirect(target.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.redirectToClientError(res, pending, 'server_error', message);
    }
  }

  private async handleSellerCentralHandshake(
    _req: Request,
    res: Response,
    query: Record<string, string>,
    pendingId: string | undefined
  ): Promise<void> {
    if (!pendingId) {
      res.status(400).type('html').send(errorPage('Missing authorization state.'));
      return;
    }

    const pending = this.clientsStore.getPendingAuthorization(pendingId);
    if (!pending) {
      res.status(400).type('html').send(errorPage('Authorization session expired. Please try again.'));
      return;
    }

    if (query.selling_partner_id) {
      pending.sellerId = query.selling_partner_id;
      this.clientsStore.updatePendingAuthorization(pending);
    }

    if (!isTrustedAmazonCallbackUri(query.amazon_callback_uri)) {
      res.status(400).type('html').send(errorPage('Untrusted Amazon callback URI.'));
      return;
    }

    const amazonCallback = new URL(query.amazon_callback_uri);
    amazonCallback.searchParams.set('amazon_state', query.amazon_state ?? '');
    amazonCallback.searchParams.set('redirect_uri', this.config.redirectUri);
    amazonCallback.searchParams.set('state', pendingId);
    res.redirect(amazonCallback.toString());
  }

  private buildAmazonAuthorizationUrl(pendingId: string): string {
    const url = new URL(this.authorizationUrl);

    if (this.config.consentMode === 'seller-central') {
      url.searchParams.set('application_id', this.config.applicationId ?? this.config.clientId);
      url.searchParams.set('redirect_uri', this.config.redirectUri);
      url.searchParams.set('state', pendingId);
      if (this.config.includeVersionBeta !== false) {
        url.searchParams.set('version', 'beta');
      }
      return url.toString();
    }

    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', pendingId);
    if (this.config.scopes.length > 0) {
      url.searchParams.set('scope', this.config.scopes.join(' '));
    }
    return url.toString();
  }

  private async exchangeAmazonCode(code: string): Promise<AmazonUserTokens> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    try {
      const response = await axios.post<LWATokenResponse>(this.tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const data = response.data;
      if (!data.refresh_token) {
        throw new Error('Amazon did not return a refresh token. Confirm the LWA app allows the requested scopes.');
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        tokenType: data.token_type,
        scope: data.scope,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as { error?: string; error_description?: string } | undefined;
        const message = data?.error_description || data?.error || error.message;
        throw new Error(`Failed to exchange Amazon authorization code: ${message}`);
      }
      throw error;
    }
  }

  private redirectPendingError(
    res: Response,
    pendingId: string | undefined,
    error: string,
    description: string
  ): void {
    if (!pendingId) {
      res.status(400).type('html').send(errorPage(description));
      return;
    }
    const pending = this.clientsStore.takePendingAuthorization(pendingId);
    if (!pending) {
      res.status(400).type('html').send(errorPage(description));
      return;
    }
    this.redirectToClientError(res, pending, error, description);
  }

  private redirectToClientError(
    res: Response,
    pending: { params: AuthorizationParams },
    error: string,
    description: string
  ): void {
    const target = new URL(pending.params.redirectUri);
    target.searchParams.set('error', error);
    target.searchParams.set('error_description', description);
    if (pending.params.state) {
      target.searchParams.set('state', pending.params.state);
    }
    clearPendingCookie(res, this.config.redirectUri);
    res.redirect(target.toString());
  }
}

function issuedScopes(scopes: string[] | undefined): string | undefined {
  if (!scopes || scopes.length === 0) {
    return undefined;
  }
  return scopes.join(' ');
}

function asQuery(query: Request['query']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      result[key] = value[0];
    }
  }
  return result;
}

function isTrustedAmazonCallbackUri(uri: string | undefined): boolean {
  if (!uri) {
    return false;
  }
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && /(?:^|\.)amazon\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function cookieSecure(redirectUri: string): boolean {
  try {
    return new URL(redirectUri).protocol === 'https:';
  } catch {
    return false;
  }
}

function setPendingCookie(res: Response, pendingId: string, redirectUri: string): void {
  const secure = cookieSecure(redirectUri) ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${PENDING_COOKIE}=${pendingId}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`
  );
}

function clearPendingCookie(res: Response, redirectUri: string): void {
  const secure = cookieSecure(redirectUri) ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `${PENDING_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`
  );
}

function readPendingCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  const parts = header.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PENDING_COOKIE) {
      return rest.join('=');
    }
  }
  return undefined;
}

function errorPage(message: string): string {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Amazon MCP authorization</title></head>
  <body>
    <h1>Authorization failed</h1>
    <p>${escaped}</p>
  </body>
</html>`;
}
