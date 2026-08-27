# ADR-006: Remote MCP with Login with Amazon

**Status:** Accepted  
**Date:** 2026-08-27  
**Decision:** Remote MCP servers speak Streamable HTTP and federate MCP OAuth 2.1 with Login with Amazon.

## Context

Clients such as Cursor and Claude can connect to MCP servers over the network, but they expect the MCP authorization spec: protected-resource metadata, authorization-server metadata, PKCE, and usually dynamic client registration.

Login with Amazon (and Seller Central consent) is OAuth 2.0 and does not implement those MCP discovery/DCR endpoints. The existing stdio servers also keep a single env-based refresh token, which is a poor fit for remote clients.

## Decision

1. Keep **stdio** as the default local transport, using env refresh tokens.
2. Add **Streamable HTTP** via `--http` / `MCP_TRANSPORT=http`.
3. Implement an MCP OAuth 2.1 authorization server in `amazon-mcp-common` that:
   - Registers MCP clients (DCR)
   - Redirects the user to Login with Amazon (Ads) or Seller Central consent (Seller)
   - Exchanges the Amazon authorization code for LWA tokens
   - Issues MCP access/refresh tokens bound to those LWA tokens
4. Tool calls run in an `AsyncLocalStorage` auth context so Amazon API requests use the logged-in user's tokens without rewriting every tool.

## Consequences

- Remote clients authenticate with the standard Login with Amazon browser flow.
- Amazon API calls in HTTP mode use the user's LWA tokens, not a shared env refresh token.
- OAuth sessions are in-memory (restart requires signing in again).
- The LWA/SP-API application must register `https://<host>/oauth/amazon/callback` as an allowed redirect URI.
