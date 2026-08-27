# ADR-006: Remote MCP with Login with Amazon

**Status:** Accepted  
**Date:** 2026-08-27  
**Decision:** MCP servers speak Streamable HTTP only and federate MCP OAuth 2.1 with Login with Amazon. There is no stdio transport and no env-based Amazon user credentials.

## Context

Clients such as Cursor and Claude can connect to MCP servers over the network, but they expect the MCP authorization spec: protected-resource metadata, authorization-server metadata, PKCE, and usually dynamic client registration.

Login with Amazon (and Seller Central consent) is OAuth 2.0 and does not implement those MCP discovery/DCR endpoints. A shared env refresh token, seller ID, or ads profile ID would override the logged-in user when multiple clients connect.

## Decision

1. Streamable HTTP is the only transport.
2. Amazon identity (tokens, seller ID, marketplace, ads profile) comes only from Login with Amazon.
3. Env config is limited to the LWA **application** (`LWA_CLIENT_ID` / `LWA_CLIENT_SECRET`), listen/public URL, and API region/endpoints.
4. Tool calls run in an `AsyncLocalStorage` auth context so Amazon API requests use the logged-in user's tokens.

## Consequences

- Clients authenticate with the standard Login with Amazon browser flow.
- Concurrent users do not share seller ID, ads profile, or refresh tokens from env.
- OAuth sessions are in-memory (restart requires signing in again).
- The LWA/SP-API application must register `https://<host>/oauth/amazon/callback` as an allowed redirect URI.
