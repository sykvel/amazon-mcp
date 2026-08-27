import { AsyncLocalStorage } from 'node:async_hooks';

export interface AmazonUserTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
  sellerId?: string;
  profileId?: string;
  marketplaceId?: string;
  participatingMarketplaceIds?: string[];
}

export interface AmazonAuthContext {
  mcpAccessToken: string;
  clientId: string;
  tokens: AmazonUserTokens;
}

const storage = new AsyncLocalStorage<AmazonAuthContext>();

export function runWithAmazonAuthContext<T>(context: AmazonAuthContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getAmazonAuthContext(): AmazonAuthContext | undefined {
  return storage.getStore();
}

export function updateAmazonAuthContextTokens(tokens: AmazonUserTokens): void {
  const store = storage.getStore();
  if (store) {
    store.tokens = tokens;
  }
}
