# Proposal

## Why

HTTP endpoints are spread across many Fastify route modules and have no central API reference. A generated inventory and a Redoc entry point give maintainers one place to browse the HTTP surface and identify endpoints whose request or response contracts still need detail.

## What Changes

- Add a reproducible OpenAPI inventory for the API's registered HTTP routes.
- Publish a Redoc reference page grouped by API area.
- Keep Socket.IO and MCP in their own documentation boundaries.
- Mark operations whose request or response schemas are not yet documented.

## Capabilities

### New Capabilities
- `api-reference`: central, generated HTTP API reference.

### Modified Capabilities
- None.

## Impact

- `apps/api`: route inventory and OpenAPI generation.
- `apps/web`: API reference page.
- Root scripts and documentation dependencies.
- OpenSpec capability `api-reference`.
