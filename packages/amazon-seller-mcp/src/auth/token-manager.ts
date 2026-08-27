import { TokenManager } from 'amazon-mcp-common';
import { validateConfig } from '../config/index.js';

let tokenManagerInstance: TokenManager | null = null;

export function getTokenManager(): TokenManager {
  if (!tokenManagerInstance) {
    const config = validateConfig();
    tokenManagerInstance = new TokenManager({
      clientId: config.LWA_CLIENT_ID,
      clientSecret: config.LWA_CLIENT_SECRET,
    });
  }
  return tokenManagerInstance;
}

export { TokenManager };
