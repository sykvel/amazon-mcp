import { describe, it, expect } from 'vitest';
import { readRemoteHttpEnv } from '../src/remote/env.js';

describe('readRemoteHttpEnv', () => {
  it('requires MCP_SERVER_URL', () => {
    expect(() => readRemoteHttpEnv({})).toThrow(/MCP_SERVER_URL is required/);
  });

  it('derives the Login with Amazon callback from the public origin', () => {
    const env = readRemoteHttpEnv({
      MCP_SERVER_URL: 'http://localhost:3000',
    });

    expect(env.publicUrl.href).toBe('http://localhost:3000/');
    expect(env.port).toBe(3000);
    expect(env.host).toBe('127.0.0.1');
    expect(env.redirectUri).toBe('http://localhost:3000/oauth/amazon/callback');
    expect(env.includeVersionBeta).toBe(true);
  });

  it('honors explicit redirect, bind, and draft flags', () => {
    const env = readRemoteHttpEnv({
      MCP_SERVER_URL: 'https://mcp.example.com',
      MCP_HTTP_HOST: '0.0.0.0',
      MCP_HTTP_PORT: '8080',
      MCP_ALLOWED_HOSTS: 'mcp.example.com, localhost',
      LWA_REDIRECT_URI: 'https://mcp.example.com/oauth/amazon/callback',
      LWA_CONSENT_DRAFT: 'false',
    });

    expect(env.host).toBe('0.0.0.0');
    expect(env.port).toBe(8080);
    expect(env.allowedHosts).toEqual(['mcp.example.com', 'localhost']);
    expect(env.redirectUri).toBe('https://mcp.example.com/oauth/amazon/callback');
    expect(env.includeVersionBeta).toBe(false);
  });
});
