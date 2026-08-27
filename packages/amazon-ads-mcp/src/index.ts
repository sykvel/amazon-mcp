#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { readRemoteHttpEnv, startRemoteMcpServer, type AmazonUserTokens } from 'amazon-mcp-common';
import { validateConfig, getAdsApiEndpoint } from './config/index.js';
import { registerAllAdsTools } from './tools/register-tools.js';

const SERVER_NAME = 'amazon-ads-mcp';
const SERVER_VERSION = '0.1.0';

function createAdsMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerAllAdsTools(server);
  return server;
}

async function enrichAdsTokens(tokens: AmazonUserTokens): Promise<AmazonUserTokens> {
  const config = validateConfig();

  try {
    const baseURL = getAdsApiEndpoint(config.ADS_API_REGION, config.ADS_API_ENDPOINT);
    const response = await axios.get<Array<{ profileId: number }>>(`${baseURL}/v2/profiles`, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        'Amazon-Advertising-API-ClientId': config.LWA_CLIENT_ID,
      },
    });
    const profileId = response.data[0]?.profileId?.toString();
    if (!profileId) {
      console.error('Warning: Login with Amazon succeeded but no advertising profiles were returned.');
    }
    return { ...tokens, profileId };
  } catch (error) {
    console.error(
      'Warning: could not load advertising profiles after Login with Amazon:',
      error instanceof Error ? error.message : error
    );
    return tokens;
  }
}

async function main(): Promise<void> {
  try {
    const config = validateConfig();
    const remote = readRemoteHttpEnv();

    const started = await startRemoteMcpServer({
      serverName: SERVER_NAME,
      serverVersion: SERVER_VERSION,
      createMcpServer: createAdsMcpServer,
      listen: { host: remote.host, port: remote.port },
      publicUrl: remote.publicUrl,
      allowedHosts: remote.allowedHosts,
      resourceName: 'Amazon Ads MCP',
      amazonOAuth: {
        clientId: config.LWA_CLIENT_ID,
        clientSecret: config.LWA_CLIENT_SECRET,
        redirectUri: remote.redirectUri,
        consentMode: 'lwa',
        authorizationUrl: 'https://www.amazon.com/ap/oa',
        scopes: ['advertising::campaign_management'],
        includeVersionBeta: remote.includeVersionBeta,
        enrichUserTokens: enrichAdsTokens,
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
    console.error('Fatal error starting server:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
