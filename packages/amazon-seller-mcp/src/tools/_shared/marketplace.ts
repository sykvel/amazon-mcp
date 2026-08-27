import { getAmazonAuthContext } from 'amazon-mcp-common';
import { getConfig } from '../../config/index.js';

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
  const participating = getParticipatingMarketplaceIds();
  if (participating[0]) {
    return participating[0];
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
