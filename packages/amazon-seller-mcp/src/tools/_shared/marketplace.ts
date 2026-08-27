import { getConfig } from '../../config/index.js';
import { getAmazonAuthContext } from 'amazon-mcp-common';

let participatingMarketplaceIds: string[] = [];

export function setParticipatingMarketplaceIds(ids: string[]): void {
  participatingMarketplaceIds = [...ids];
}

export function getParticipatingMarketplaceIds(): string[] {
  const ctx = getAmazonAuthContext();
  if (ctx?.tokens.participatingMarketplaceIds?.length) {
    return [...ctx.tokens.participatingMarketplaceIds];
  }
  return [...participatingMarketplaceIds];
}

export function resolveMarketplaceId(inputMarketplaceId?: string): string {
  if (inputMarketplaceId) {
    return inputMarketplaceId;
  }
  const ctx = getAmazonAuthContext();
  if (ctx?.tokens.marketplaceId) {
    return ctx.tokens.marketplaceId;
  }
  return getConfig().MARKETPLACE_ID;
}

export function validateMarketplaceId(id: string): void {
  const allowed = getParticipatingMarketplaceIds();
  if (allowed.length === 0) {
    return;
  }

  if (!allowed.includes(id)) {
    throw new Error(
      `Marketplace ID "${id}" is not in this seller's participating marketplaces: [${allowed.join(', ')}].`
    );
  }
}
