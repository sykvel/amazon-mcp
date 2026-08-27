import { z } from 'zod';
import dotenv from 'dotenv';
import { getAmazonAuthContext } from 'amazon-mcp-common';

dotenv.config();

const configSchema = z.object({
  LWA_CLIENT_ID: z.string().min(1, 'LWA_CLIENT_ID is required'),
  LWA_CLIENT_SECRET: z.string().min(1, 'LWA_CLIENT_SECRET is required'),
  SP_API_ENDPOINT: z.string().url().default('https://sellingpartnerapi-na.amazon.com'),
  SP_API_APPLICATION_ID: z.string().min(1).optional(),
  SELLER_CENTRAL_URL: z.string().url().optional(),
});

export type Config = {
  LWA_CLIENT_ID: string;
  LWA_CLIENT_SECRET: string;
  SP_API_ENDPOINT: string;
  SP_API_APPLICATION_ID?: string;
  SELLER_CENTRAL_URL?: string;
  SELLER_ID: string;
  MARKETPLACE_ID: string;
};

type AppConfig = Omit<Config, 'SELLER_ID' | 'MARKETPLACE_ID'>;

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

export function getConfig(): Config {
  const config = cachedConfig ?? validateConfig();
  const ctx = getAmazonAuthContext();
  return {
    ...config,
    SELLER_ID: requireSessionValue('seller ID', ctx?.tokens.sellerId),
    MARKETPLACE_ID: requireSessionValue(
      'marketplace ID',
      ctx?.tokens.marketplaceId || ctx?.tokens.participatingMarketplaceIds?.[0]
    ),
  };
}

function requireSessionValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `No ${name} for this Login with Amazon session. Sign in again, or pass the value on the tool call.`
    );
  }
  return value;
}

export const MARKETPLACE_IDS = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
  BR: 'A2Q3Y263D00KWC',
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYBER',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
  NL: 'A1805IZSGTT6HS',
  SE: 'A2NODRKZP88ZB9',
  PL: 'A1C3SOZRARQ6R3',
  BE: 'AMEN7PMS3EDWL',
  JP: 'A1VC38T7YXB528',
  AU: 'A39IBJ37TRP1C6',
  SG: 'A19VAU5U5O7RUS',
  IN: 'A21TJRUUN4KGV',
  AE: 'A2VIGQ35RCS4UG',
  SA: 'A17E79C6D8DWNP',
  EG: 'ARBP9OOSHTCHU',
  TR: 'A33AVAJ2PDY3EV',
} as const;

export const SP_API_ENDPOINTS = {
  NA: 'https://sellingpartnerapi-na.amazon.com',
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
} as const;
