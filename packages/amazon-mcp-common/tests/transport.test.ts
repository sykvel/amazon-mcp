import { describe, it, expect } from 'vitest';
import { resolveMcpTransportMode } from '../src/remote/transport.js';

describe('resolveMcpTransportMode', () => {
  it('defaults to stdio', () => {
    expect(resolveMcpTransportMode(['node', 'index.js'], {})).toBe('stdio');
  });

  it('selects http from --http', () => {
    expect(resolveMcpTransportMode(['node', 'index.js', '--http'], {})).toBe('http');
  });

  it('selects http from MCP_TRANSPORT', () => {
    expect(resolveMcpTransportMode(['node', 'index.js'], { MCP_TRANSPORT: 'http' })).toBe('http');
  });

  it('prefers CLI over env', () => {
    expect(
      resolveMcpTransportMode(['node', 'index.js', '--stdio'], { MCP_TRANSPORT: 'http' })
    ).toBe('stdio');
  });
});
