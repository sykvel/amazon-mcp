import type { Request, Response, NextFunction } from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { logDebug, logError, logInfo, redact, summarizeJsonRpc } from '../log.js';

export function mcpHttpLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  const rpc = summarizeJsonRpc(req.body);
  const sessionId = headerValue(req.headers['mcp-session-id']);
  const requestLog = {
    http: req.method,
    path: req.path,
    sessionId,
    ...rpc,
  };

  if (rpc) {
    logInfo('MCP request', requestLog);
  } else {
    logDebug('HTTP request', requestLog);
  }

  res.on('finish', () => {
    const payload = {
      ...requestLog,
      status: res.statusCode,
      ms: Date.now() - started,
    };
    if (res.statusCode >= 400) {
      logError('HTTP error', payload);
      return;
    }
    logDebug('HTTP response', payload);
  });

  next();
}

export function httpNotFoundHandler(req: Request, res: Response): void {
  logError('HTTP 404', {
    http: req.method,
    path: req.path,
    query: req.query,
    params: redact(req.body),
  });
  res.status(404).json({
    error: 'not_found',
    message: `No route for ${req.method} ${req.path}`,
  });
}

export function attachMcpProtocolLogging(mcp: McpServer): void {
  mcp.server.onerror = (error: Error): void => {
    logError('MCP protocol error', {
      message: error.message,
      stack: error.stack,
    });
  };

  mcp.server.fallbackRequestHandler = async (request) => {
    const params = redact(request.params);
    logError('MCP method not found', {
      method: request.method,
      id: request.id,
      params,
    });
    throw new McpError(ErrorCode.MethodNotFound, `Method not found: ${request.method}`, {
      method: request.method,
      params,
    });
  };

  mcp.server.fallbackNotificationHandler = async (notification): Promise<void> => {
    logDebug('MCP notification ignored', {
      method: notification.method,
      params: redact(
        'params' in notification ? (notification as { params?: unknown }).params : undefined
      ),
    });
  };
}

export function wrapTransportLogging(transport: StreamableHTTPServerTransport): void {
  const originalSend = transport.send.bind(transport);
  transport.send = async (message, options) => {
    logOutgoingJsonRpc(message);
    return originalSend(message, options);
  };
  const previousOnError = transport.onerror;
  transport.onerror = (error: Error): void => {
    logError('MCP transport error', { message: error.message, stack: error.stack });
    previousOnError?.(error);
  };
}

function logOutgoingJsonRpc(message: unknown): void {
  const messages = Array.isArray(message) ? message : [message];
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const rpc = entry as Record<string, unknown>;
    if (rpc.error) {
      logError('MCP JSON-RPC error', {
        id: rpc.id,
        error: redact(rpc.error),
      });
      continue;
    }
    logDebug('MCP JSON-RPC result', { id: rpc.id, method: rpc.method });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
