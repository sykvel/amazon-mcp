export interface RemoteHttpEnv {
  publicUrl: URL;
  host: string;
  port: number;
  allowedHosts?: string[];
  redirectUri: string;
  includeVersionBeta: boolean;
}

export function readRemoteHttpEnv(env: NodeJS.ProcessEnv = process.env): RemoteHttpEnv {
  const publicUrlRaw = env.MCP_SERVER_URL?.trim();
  if (!publicUrlRaw) {
    throw new Error(
      'MCP_SERVER_URL is required for HTTP transport.\n' +
        'Example: MCP_SERVER_URL=http://localhost:3000 or MCP_SERVER_URL=https://mcp.example.com'
    );
  }

  let publicUrl: URL;
  try {
    publicUrl = new URL(publicUrlRaw);
  } catch {
    throw new Error(`MCP_SERVER_URL is not a valid URL: ${publicUrlRaw}`);
  }

  const port = env.MCP_HTTP_PORT ? Number(env.MCP_HTTP_PORT) : 3000;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`MCP_HTTP_PORT must be a positive integer, got: ${env.MCP_HTTP_PORT}`);
  }

  const allowedHosts = env.MCP_ALLOWED_HOSTS
    ?.split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const redirectUri =
    env.LWA_REDIRECT_URI?.trim() || new URL('/oauth/amazon/callback', publicUrl.origin).href;

  return {
    publicUrl,
    host: env.MCP_HTTP_HOST?.trim() || '127.0.0.1',
    port,
    allowedHosts: allowedHosts && allowedHosts.length > 0 ? allowedHosts : undefined,
    redirectUri,
    includeVersionBeta: env.LWA_CONSENT_DRAFT !== 'false',
  };
}
