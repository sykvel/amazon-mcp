import { z } from 'zod';
import dotenv from 'dotenv';
import { getAmazonAuthContext } from 'amazon-mcp-common';

dotenv.config();

const configSchema = z.object({
  LWA_CLIENT_ID: z.string().min(1, 'LWA_CLIENT_ID is required'),
  LWA_CLIENT_SECRET: z.string().min(1, 'LWA_CLIENT_SECRET is required'),
  ADS_API_REGION: z.enum(['na', 'eu', 'fe']).default('na'),
  ADS_API_ENDPOINT: z.string().url().optional(),
});

export type AdsConfig = {
  LWA_CLIENT_ID: string;
  LWA_CLIENT_SECRET: string;
  ADS_API_REGION: 'na' | 'eu' | 'fe';
  ADS_API_ENDPOINT?: string;
  ADS_PROFILE_ID: string;
};

type AppConfig = Omit<AdsConfig, 'ADS_PROFILE_ID'>;

let cachedConfig: AppConfig | null = null;

export function validateConfig(): AppConfig {
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

  cachedConfig = result.data;
  return cachedConfig;
}

export function getConfig(): AdsConfig {
  const config = cachedConfig ?? validateConfig();
  const ctx = getAmazonAuthContext();
  const profileId = ctx?.tokens.profileId;
  if (!profileId) {
    throw new Error(
      'No advertising profile ID for this Login with Amazon session. Sign in again so a profile can be selected.'
    );
  }
  return {
    ...config,
    ADS_PROFILE_ID: profileId,
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
