#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { readRemoteHttpEnv, startRemoteMcpServer, type AmazonUserTokens } from 'amazon-mcp-common';
import { validateConfig } from './config/index.js';
import { registerAllTools } from './tools/index.js';
import type { GetMarketplaceParticipationsResponse } from './types/sp-api.js';

const SERVER_NAME = 'amazon-seller-mcp';
const SERVER_VERSION = '1.0.0';

function createSellerMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  registerAllTools(server);
  return server;
}

async function enrichSellerTokens(tokens: AmazonUserTokens): Promise<AmazonUserTokens> {
  const config = validateConfig();
  const next: AmazonUserTokens = { ...tokens };

  try {
    const response = await axios.get<GetMarketplaceParticipationsResponse>(
      `${config.SP_API_ENDPOINT}/sellers/v1/marketplaceParticipations`,
      {
        headers: {
          'x-amz-access-token': tokens.accessToken,
          'User-Agent': 'amazon-seller-mcp/1.0.0 (Language=TypeScript)',
        },
      }
    );
    const ids = (response.data.payload ?? [])
      .filter((entry) => entry.participation?.isParticipating === true)
      .map((entry) => entry.marketplace.id);
    next.participatingMarketplaceIds = ids;
    if (!next.marketplaceId && ids[0]) {
      next.marketplaceId = ids[0];
    }
  } catch (error) {
    console.error(
      'Warning: could not load marketplace participations after Login with Amazon:',
      error instanceof Error ? error.message : error
    );
  }

  return next;
}

async function main(): Promise<void> {
  try {
    const config = validateConfig();
    const remote = readRemoteHttpEnv();
    const authorizationUrl =
      config.SELLER_CENTRAL_URL ?? 'https://sellercentral.amazon.com/apps/authorize/consent';

    const started = await startRemoteMcpServer({
      serverName: SERVER_NAME,
      serverVersion: SERVER_VERSION,
      createMcpServer: createSellerMcpServer,
      listen: { host: remote.host, port: remote.port },
      publicUrl: remote.publicUrl,
      allowedHosts: remote.allowedHosts,
      resourceName: 'Amazon Seller MCP',
      amazonOAuth: {
        clientId: config.LWA_CLIENT_ID,
        clientSecret: config.LWA_CLIENT_SECRET,
        redirectUri: remote.redirectUri,
        consentMode: 'seller-central',
        authorizationUrl,
        applicationId: config.SP_API_APPLICATION_ID ?? config.LWA_CLIENT_ID,
        includeVersionBeta: remote.includeVersionBeta,
        scopes: [],
        enrichUserTokens: enrichSellerTokens,
      },
    });

    const shutdown = async (): Promise<void> => {
      await started.close();
      process.exit(0);
    };
    process.on('SIGINT', () => {
      void shutdown();
    });
    process.on('SIGTERM', () => {
      void shutdown();
    });
  } catch (error) {
    console.error('Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
