import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { Request, Response } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  getAmazonAuthContext,
  runWithAmazonAuthContext,
  type AmazonAuthContext,
} from './amazon-auth-context.js';
import {
  AmazonFederatedOAuthProvider,
  type AmazonOAuthConfig,
} from './lwa-oauth-provider.js';
import { InMemoryOAuthStore, setActiveOAuthStore } from './oauth-store.js';

export interface RemoteMcpListenConfig {
  host: string;
  port: number;
}

export interface RemoteMcpServerOptions {
  serverName: string;
  serverVersion: string;
  createMcpServer: () => McpServer;
  amazonOAuth: AmazonOAuthConfig;
  listen: RemoteMcpListenConfig;
  publicUrl: URL;
  allowedHosts?: string[];
  resourceName?: string;
  scopesSupported?: string[];
}

export interface StartedRemoteMcpServer {
  httpServer: Server;
  mcpUrl: URL;
  issuerUrl: URL;
  close: () => Promise<void>;
}

const transports = new Map<string, StreamableHTTPServerTransport>();

export async function startRemoteMcpServer(
  options: RemoteMcpServerOptions
): Promise<StartedRemoteMcpServer> {
  const { issuerUrl, mcpUrl } = resolvePublicUrls(options.publicUrl);
  allowHttpIssuerIfNeeded(issuerUrl);

  const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = await import(
    '@modelcontextprotocol/sdk/server/auth/router.js'
  );

  const store = new InMemoryOAuthStore();
  setActiveOAuthStore(store);
  const provider = new AmazonFederatedOAuthProvider(options.amazonOAuth, store);
  const allowedHosts = resolveAllowedHosts(options);
  const app = createMcpExpressApp({
    host: options.listen.host,
    allowedHosts,
  });

  app.use(corsMiddleware);

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      baseUrl: issuerUrl,
      resourceServerUrl: mcpUrl,
      resourceName: options.resourceName ?? options.serverName,
      scopesSupported: options.scopesSupported ?? ['mcp:tools'],
    })
  );

  const callbackPath = new URL(options.amazonOAuth.redirectUri).pathname;
  app.get(callbackPath, (req, res) => {
    void provider.handleAmazonCallback(req, res);
  });

  const authMiddleware = requireBearerAuth({
    verifier: provider,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
  });

  const withAmazonContext = (
    handler: (req: Request, res: Response) => Promise<void>
  ): ((req: Request, res: Response) => void) => {
    return (req: Request, res: Response): void => {
      void (async (): Promise<void> => {
        const auth = req.auth as AuthInfo | undefined;
        if (!auth) {
          res.status(401).json({ error: 'unauthorized', error_description: 'Missing auth context' });
          return;
        }
        const record = store.getAccessToken(auth.token);
        if (!record) {
          res.status(401).json({ error: 'invalid_token', error_description: 'Unknown access token' });
          return;
        }
        await runWithAmazonAuthContext(
          {
            mcpAccessToken: auth.token,
            clientId: auth.clientId,
            tokens: record.lwaTokens,
          },
          () => handler(req, res)
        );
      })().catch((error: unknown) => {
        console.error('MCP request failed:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      });
    };
  };

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      server: options.serverName,
      version: options.serverVersion,
      transport: 'streamable-http',
    });
  });

  app.get('/', (_req, res) => {
    res.type('html').send(landingPage(options.serverName, mcpUrl));
  });

  app.post('/mcp', authMiddleware, withAmazonContext(handleMcpPost(options)));
  app.get('/mcp', authMiddleware, withAmazonContext(handleMcpGet));
  app.delete('/mcp', authMiddleware, withAmazonContext(handleMcpDelete));

  const httpServer = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(options.listen.port, options.listen.host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });

  const close = async (): Promise<void> => {
    for (const [sessionId, transport] of transports) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error closing MCP session ${sessionId}:`, error);
      }
      transports.delete(sessionId);
    }
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    setActiveOAuthStore(undefined);
  };

  console.log(
    `${options.serverName} v${options.serverVersion} remote MCP listening on ${options.listen.host}:${options.listen.port}`
  );
  console.log(`MCP endpoint: ${mcpUrl.href}`);
  console.log(`Login with Amazon callback: ${options.amazonOAuth.redirectUri}`);
  console.log('Clients should connect with OAuth (Login with Amazon).');

  return { httpServer, mcpUrl, issuerUrl, close };
}

function handleMcpPost(
  options: RemoteMcpServerOptions
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: (): string => randomUUID(),
        onsessioninitialized: (id: string): void => {
          transports.set(id, transport);
        },
      });

      transport.onclose = (): void => {
        const id = transport.sessionId;
        if (id) {
          transports.delete(id);
        }
      };

      const server = options.createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    });
  };
}

async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
}

async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
}

export function resolvePublicUrls(publicUrl: URL): { issuerUrl: URL; mcpUrl: URL } {
  const issuerUrl = new URL(publicUrl.origin);
  const mcpUrl =
    publicUrl.pathname && publicUrl.pathname !== '/'
      ? new URL(publicUrl.href)
      : new URL('/mcp', issuerUrl);
  return { issuerUrl, mcpUrl };
}

function allowHttpIssuerIfNeeded(issuerUrl: URL): void {
  if (issuerUrl.protocol !== 'http:') {
    return;
  }
  if (
    process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL === 'true' ||
    process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL === '1'
  ) {
    return;
  }
  process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = 'true';
  console.warn(
    'MCP_SERVER_URL is HTTP. Enabling insecure issuer URLs for local development. Use HTTPS in production.'
  );
}

function resolveAllowedHosts(options: RemoteMcpServerOptions): string[] {
  if (options.allowedHosts && options.allowedHosts.length > 0) {
    return options.allowedHosts;
  }
  const hosts = new Set<string>([
    options.publicUrl.hostname,
    'localhost',
    '127.0.0.1',
  ]);
  if (options.listen.host && options.listen.host !== '0.0.0.0' && options.listen.host !== '::') {
    hosts.add(options.listen.host);
  }
  return [...hosts];
}

function corsMiddleware(req: Request, res: Response, next: () => void): void {
  const origin = req.headers.origin ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, mcp-session-id, Last-Event-ID'
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (origin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

function landingPage(serverName: string, mcpUrl: URL): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${serverName}</title></head>
  <body>
    <h1>${serverName}</h1>
    <p>Remote MCP server with Login with Amazon.</p>
    <p>Connect an MCP client to <code>${mcpUrl.href}</code>. The client will prompt you to sign in with Amazon.</p>
    <p>Health check: <a href="/health">/health</a></p>
  </body>
</html>`;
}

export function requireAmazonAuthContext(): AmazonAuthContext {
  const context = getAmazonAuthContext();
  if (!context) {
    throw new InvalidTokenError('No Amazon login is associated with this MCP session');
  }
  return context;
}
