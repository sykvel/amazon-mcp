import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import type { Response } from 'express';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { AmazonFederatedOAuthProvider } from '../src/remote/lwa-oauth-provider.js';
import { InMemoryOAuthStore } from '../src/remote/oauth-store.js';

vi.mock('axios');

function client(): OAuthClientInformationFull {
  return {
    client_id: 'mcp-client',
    redirect_uris: ['http://127.0.0.1:54321/callback'],
    client_secret: 'secret',
  };
}

function mockResponse(): Response & { redirectUrl?: string } {
  const res = {
    redirectUrl: undefined as string | undefined,
    cookies: [] as string[],
    redirect(url: string) {
      this.redirectUrl = url;
    },
    append(_name: string, value: string) {
      this.cookies.push(value);
    },
    status() {
      return this;
    },
    type() {
      return this;
    },
    send() {
      return this;
    },
  };
  return res as unknown as Response & { redirectUrl?: string };
}

describe('AmazonFederatedOAuthProvider', () => {
  let store: InMemoryOAuthStore;
  let provider: AmazonFederatedOAuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new InMemoryOAuthStore();
    provider = new AmazonFederatedOAuthProvider(
      {
        clientId: 'amzn1.application-oa2-client.test',
        clientSecret: 'lwa-secret',
        redirectUri: 'http://localhost:3000/oauth/amazon/callback',
        consentMode: 'lwa',
        scopes: ['advertising::campaign_management'],
      },
      store
    );
  });

  it('redirects MCP clients to Login with Amazon', async () => {
    const res = mockResponse();
    await provider.authorize(
      client(),
      {
        redirectUri: 'http://127.0.0.1:54321/callback',
        codeChallenge: 'challenge',
        state: 'mcp-state',
        scopes: ['mcp:tools'],
      },
      res
    );

    const location = new URL((res as unknown as { redirectUrl: string }).redirectUrl);
    expect(location.origin + location.pathname).toBe('https://www.amazon.com/ap/oa');
    expect(location.searchParams.get('client_id')).toBe('amzn1.application-oa2-client.test');
    expect(location.searchParams.get('scope')).toBe('advertising::campaign_management');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/oauth/amazon/callback'
    );
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('exchanges an Amazon code and issues an MCP authorization code', async () => {
    const res = mockResponse();
    await provider.authorize(
      await store.registerClient(client()),
      {
        redirectUri: 'http://127.0.0.1:54321/callback',
        codeChallenge: 'challenge',
        state: 'mcp-state',
      },
      res
    );

    const amazonUrl = new URL((res as unknown as { redirectUrl: string }).redirectUrl);
    const pendingId = amazonUrl.searchParams.get('state')!;

    vi.mocked(axios.post).mockResolvedValue({
      data: {
        access_token: 'lwa-access',
        refresh_token: 'lwa-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        scope: 'advertising::campaign_management',
      },
    });

    const callbackRes = mockResponse();
    await provider.handleAmazonCallback(
      {
        query: { state: pendingId, code: 'amazon-code' },
        headers: {},
      } as never,
      callbackRes
    );

    const clientRedirect = new URL((callbackRes as unknown as { redirectUrl: string }).redirectUrl);
    expect(clientRedirect.origin).toBe('http://127.0.0.1:54321');
    expect(clientRedirect.searchParams.get('state')).toBe('mcp-state');
    const code = clientRedirect.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokens = await provider.exchangeAuthorizationCode(client(), code!);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.token_type).toBe('bearer');

    const auth = await provider.verifyAccessToken(tokens.access_token);
    expect(auth.clientId).toBe('mcp-client');
    expect(auth.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('redirects seller-central apps to Amazon consent with version=beta by default', async () => {
    provider = new AmazonFederatedOAuthProvider(
      {
        clientId: 'amzn1.application-oa2-client.test',
        clientSecret: 'lwa-secret',
        redirectUri: 'http://localhost:3001/oauth/amazon/callback',
        consentMode: 'seller-central',
        scopes: [],
        applicationId: 'amzn1.sellerapps.app.test',
      },
      store
    );

    const res = mockResponse();
    await provider.authorize(
      client(),
      {
        redirectUri: 'http://127.0.0.1:54321/callback',
        codeChallenge: 'challenge',
      },
      res
    );

    const location = new URL((res as unknown as { redirectUrl: string }).redirectUrl);
    expect(location.pathname).toBe('/apps/authorize/consent');
    expect(location.searchParams.get('application_id')).toBe('amzn1.sellerapps.app.test');
    expect(location.searchParams.get('version')).toBe('beta');
  });
});
