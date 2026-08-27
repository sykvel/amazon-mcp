import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/index.js', () => ({
  validateConfig: () => ({
    LWA_CLIENT_ID: 'test-client-id',
    LWA_CLIENT_SECRET: 'test-client-secret',
    SP_API_ENDPOINT: 'https://sellingpartnerapi-na.amazon.com',
  }),
  getConfig: () => ({
    LWA_CLIENT_ID: 'test-client-id',
    LWA_CLIENT_SECRET: 'test-client-secret',
    SELLER_ID: 'test',
    MARKETPLACE_ID: 'ATVPDKIKX0DER',
    SP_API_ENDPOINT: 'https://sellingpartnerapi-na.amazon.com',
  }),
}));

import { getTokenManager } from '../src/auth/token-manager.js';

describe('getTokenManager', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a TokenManager instance', () => {
    const manager = getTokenManager();
    expect(manager).toBeDefined();
    expect(typeof manager.getAccessToken).toBe('function');
    expect(typeof manager.clearCache).toBe('function');
    expect(typeof manager.invalidateToken).toBe('function');
  });

  it('returns the same singleton instance', () => {
    const first = getTokenManager();
    const second = getTokenManager();
    expect(first).toBe(second);
  });

  it('has isTokenExpired and getTokenExpiry methods', () => {
    const manager = getTokenManager();
    expect(typeof manager.isTokenExpired).toBe('function');
    expect(typeof manager.getTokenExpiry).toBe('function');
  });
});
