import { z } from 'zod';
import dotenv from 'dotenv';
import { getAmazonAuthContext, resolveMcpTransportMode } from 'amazon-mcp-common';

dotenv.config();

const sharedSchema = z.object({
  LWA_CLIENT_ID: z.string().min(1, 'LWA_CLIENT_ID is required'),
  LWA_CLIENT_SECRET: z.string().min(1, 'LWA_CLIENT_SECRET is required'),
  LWA_REFRESH_TOKEN: z.string().min(1).optional(),
  SELLER_ID: z.string().min(1).optional(),
  MARKETPLACE_ID: z.string().min(1).optional(),
  SP_API_ENDPOINT: z.string().url().default('https://sellingpartnerapi-na.amazon.com'),
  SP_API_APPLICATION_ID: z.string().min(1).optional(),
  SELLER_CENTRAL_URL: z.string().url().optional(),
});

export type Config = {
  LWA_CLIENT_ID: string;
  LWA_CLIENT_SECRET: string;
  LWA_REFRESH_TOKEN?: string;
  SELLER_ID: string;
  MARKETPLACE_ID: string;
  SP_API_ENDPOINT: string;
  SP_API_APPLICATION_ID?: string;
  SELLER_CENTRAL_URL?: string;
};

let cachedConfig: Config | null = null;

function envForParse(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LWA_REFRESH_TOKEN: process.env.LWA_REFRESH_TOKEN || process.env.SELLER_REFRESH_TOKEN,
  };
}

function toConfig(data: z.infer<typeof sharedSchema>): Config {
  return {
    LWA_CLIENT_ID: data.LWA_CLIENT_ID,
    LWA_CLIENT_SECRET: data.LWA_CLIENT_SECRET,
    LWA_REFRESH_TOKEN: data.LWA_REFRESH_TOKEN,
    SELLER_ID: data.SELLER_ID ?? '',
    MARKETPLACE_ID: data.MARKETPLACE_ID ?? 'ATVPDKIKX0DER',
    SP_API_ENDPOINT: data.SP_API_ENDPOINT,
    SP_API_APPLICATION_ID: data.SP_API_APPLICATION_ID,
    SELLER_CENTRAL_URL: data.SELLER_CENTRAL_URL,
  };
}

export function validateConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = sharedSchema.safeParse(envForParse());
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
    if (!result.data.LWA_REFRESH_TOKEN) {
      missing.push('LWA_REFRESH_TOKEN (or SELLER_REFRESH_TOKEN)');
    }
    if (!result.data.SELLER_ID) {
      missing.push('SELLER_ID');
    }
    if (!result.data.MARKETPLACE_ID) {
      missing.push('MARKETPLACE_ID');
    }
    if (missing.length > 0) {
      throw new Error(
        `Configuration validation failed:\n${missing.map((name) => `  - ${name}: Required for stdio mode`).join('\n')}`
      );
    }
  }

  cachedConfig = toConfig(result.data);
  return cachedConfig;
}

export function getConfig(): Config {
  const config = cachedConfig ?? validateConfig();
  const ctx = getAmazonAuthContext();
  if (!ctx) {
    return config;
  }
  return {
    ...config,
    SELLER_ID: ctx.tokens.sellerId || config.SELLER_ID,
    MARKETPLACE_ID: ctx.tokens.marketplaceId || config.MARKETPLACE_ID,
  };
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
