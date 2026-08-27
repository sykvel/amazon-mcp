export type McpTransportMode = 'stdio' | 'http';

export function resolveMcpTransportMode(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): McpTransportMode {
  if (argv.includes('--http') || argv.includes('--transport=http')) {
    return 'http';
  }
  if (argv.includes('--stdio') || argv.includes('--transport=stdio')) {
    return 'stdio';
  }

  const fromEnv = env.MCP_TRANSPORT?.trim().toLowerCase();
  if (fromEnv === 'http' || fromEnv === 'streamable-http' || fromEnv === 'streamable_http') {
    return 'http';
  }

  return 'stdio';
}
