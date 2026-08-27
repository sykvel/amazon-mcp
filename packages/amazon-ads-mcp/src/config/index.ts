import { z } from 'zod';
import dotenv from 'dotenv';
import { getAmazonAuthContext, resolveMcpTransportMode } from 'amazon-mcp-common';

dotenv.config();

const configSchema = z.object({
  LWA_CLIENT_ID: z.string().min(1, 'LWA_CLIENT_ID is required'),
  LWA_CLIENT_SECRET: z.string().min(1, 'LWA_CLIENT_SECRET is required'),
  ADS_REFRESH_TOKEN: z.string().min(1).optional(),
  ADS_PROFILE_ID: z.string().min(1).optional(),
  ADS_API_REGION: z.enum(['na', 'eu', 'fe']).default('na'),
  ADS_API_ENDPOINT: z.string().url().optional(),
});

export type AdsConfig = {
  LWA_CLIENT_ID: string;
  LWA_CLIENT_SECRET: string;
  ADS_REFRESH_TOKEN?: string;
  ADS_PROFILE_ID: string;
  ADS_API_REGION: 'na' | 'eu' | 'fe';
  ADS_API_ENDPOINT?: string;
};

let cachedConfig: AdsConfig | null = null;

export function validateConfig(): AdsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `  - ${e.path.join('.')}: ${e.message}`);
    throw new Error(
      `Configuration validation failed:\n${errors.join('\n')}\n\n` +
        'Please ensure all required environment variables are set.\n' +
        'See .env.example for reference.'
    );
  }

  const http = resolveMcpTransportMode() === 'http';
  if (!http) {
    const missing: string[] = [];
    if (!result.data.ADS_REFRESH_TOKEN) {
      missing.push('ADS_REFRESH_TOKEN');
    }
    if (!result.data.ADS_PROFILE_ID) {
      missing.push('ADS_PROFILE_ID');
    }
    if (missing.length > 0) {
      throw new Error(
        `Configuration validation failed:\n${missing.map((name) => `  - ${name}: Required for stdio mode`).join('\n')}`
      );
    }
  }

  cachedConfig = {
    LWA_CLIENT_ID: result.data.LWA_CLIENT_ID,
    LWA_CLIENT_SECRET: result.data.LWA_CLIENT_SECRET,
    ADS_REFRESH_TOKEN: result.data.ADS_REFRESH_TOKEN,
    ADS_PROFILE_ID: result.data.ADS_PROFILE_ID ?? '',
    ADS_API_REGION: result.data.ADS_API_REGION,
    ADS_API_ENDPOINT: result.data.ADS_API_ENDPOINT,
  };
  return cachedConfig;
}

export function getConfig(): AdsConfig {
  const config = cachedConfig ?? validateConfig();
  const ctx = getAmazonAuthContext();
  if (!ctx) {
    return config;
  }
  return {
    ...config,
    ADS_PROFILE_ID: ctx.tokens.profileId || config.ADS_PROFILE_ID,
  };
}

export const ADS_API_ENDPOINTS = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
} as const;

export function getAdsApiEndpoint(region: 'na' | 'eu' | 'fe', override?: string): string {
  return override ?? ADS_API_ENDPOINTS[region];
}
