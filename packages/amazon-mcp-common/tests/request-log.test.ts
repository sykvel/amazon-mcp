import { afterEach, describe, expect, it } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setLogSink } from '../src/log.js';
import { attachMcpProtocolLogging } from '../src/remote/request-log.js';

describe('attachMcpProtocolLogging', () => {
  afterEach(() => {
    setLogSink(undefined);
    delete process.env.MCP_LOG_LEVEL;
  });

  it('logs unknown JSON-RPC methods with params and throws Method not found', async () => {
    process.env.MCP_LOG_LEVEL = 'error';
    const lines: string[] = [];
    setLogSink((_level, message) => {
      lines.push(message);
    });

    const mcp = {
      server: {},
    } as McpServer;
    attachMcpProtocolLogging(mcp);

    const request = {
      jsonrpc: '2.0' as const,
      id: 12,
      method: 'tools/unknown',
      params: { name: 'missing_tool', arguments: { sku: 'ABC' } },
    };

    let thrown: unknown;
    try {
      await mcp.server.fallbackRequestHandler?.(request, {} as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(McpError);
    expect(thrown).toMatchObject({ code: ErrorCode.MethodNotFound });
    expect(String(thrown)).toContain('Method not found: tools/unknown');
    expect(lines.some((line) => line.includes('MCP method not found'))).toBe(true);
    expect(lines[0]).toContain('"method":"tools/unknown"');
    expect(lines[0]).toContain('"sku":"ABC"');
  });
});
