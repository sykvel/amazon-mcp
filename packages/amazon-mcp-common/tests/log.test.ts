import { afterEach, describe, expect, it } from 'vitest';
import {
  getLogLevel,
  logError,
  logInfo,
  parseLogLevel,
  redact,
  setLogSink,
  summarizeJsonRpc,
} from '../src/log.js';

describe('log', () => {
  const originalLevel = process.env.MCP_LOG_LEVEL;

  afterEach(() => {
    setLogSink(undefined);
    if (originalLevel === undefined) {
      delete process.env.MCP_LOG_LEVEL;
    } else {
      process.env.MCP_LOG_LEVEL = originalLevel;
    }
  });

  it('defaults to silent during tests and info otherwise', () => {
    delete process.env.MCP_LOG_LEVEL;
    expect(parseLogLevel(undefined)).toBe('silent');
    expect(parseLogLevel('debug')).toBe('debug');
    expect(parseLogLevel('nope')).toBe('silent');
  });

  it('redacts tokens and secrets in nested params', () => {
    expect(
      redact({
        name: 'get_orders',
        arguments: { marketplaceId: 'ATVPDKIKX0DER' },
        refreshToken: 'Atzr|secret',
        nested: { access_token: 'abc', client_secret: 'shh' },
      })
    ).toEqual({
      name: 'get_orders',
      arguments: { marketplaceId: 'ATVPDKIKX0DER' },
      refreshToken: '[redacted]',
      nested: { access_token: '[redacted]', client_secret: '[redacted]' },
    });
  });

  it('summarizes JSON-RPC tool calls including params', () => {
    expect(
      summarizeJsonRpc({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_orders', arguments: { createdAfter: '2026-01-01' } },
      })
    ).toEqual({
      id: 7,
      method: 'tools/call',
      params: { name: 'get_orders', arguments: { createdAfter: '2026-01-01' } },
    });
  });

  it('logs errors when MCP_LOG_LEVEL is error or higher', () => {
    process.env.MCP_LOG_LEVEL = 'error';
    expect(getLogLevel()).toBe('error');
    const lines: string[] = [];
    setLogSink((_level, message) => {
      lines.push(message);
    });

    logInfo('MCP request', { method: 'tools/call' });
    logError('MCP method not found', { method: 'foo/bar', params: { a: 1 } });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('MCP method not found');
    expect(lines[0]).toContain('"method":"foo/bar"');
    expect(lines[0]).toContain('"params":{"a":1}');
  });
});
