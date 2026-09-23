# Proposal

## Why

The evaluated `Shudesu/line-harness-oss` repository provides two useful capabilities for Open333CRM: retry-safe LINE API delivery and a practical LINE-focused MCP tool surface. Its full Worker/D1 CRM runtime overlaps with Open333CRM and would introduce a second data, tenant, webhook, and scheduling system.

This change extracts the reusable delivery and MCP concepts into Open333CRM's existing Fastify, channel-plugin, Prisma/RLS, and MCP boundaries.

## What Changes

- Add a typed LINE API client layer for outbound delivery errors, request IDs, and LINE retry keys.
- Extend LINE push, multicast, narrowcast, and broadcast delivery with deterministic retry-key handling, HTTP 409 accepted ID detection, and idempotent result recording.
- Preserve the existing reply-token safety rules and non-LINE channel behavior.
- Add tenant-scoped LINE MCP operations for conversation discovery, direct message sending, and broadcast initiation.
- Require explicit authorization scopes and 2-phase confirmation semantics for MCP write operations.
- Reuse the current Open333CRM channel credentials, tenant-bound Prisma clients, RBAC, and existing webhook ownership.
- Add unit and integration coverage for retry behavior, MCP authorization, tenant isolation, and duplicate-send prevention.
- Exclude the remote repository's Worker, D1 schema, Pages UI, second webhook runtime, standalone SDK package, and cross-account migration behavior.

## Capabilities

### New Capabilities

- `line-api-client-resilience`: Typed LINE API errors, request IDs, retry keys, and duplicate-send prevention for supported outbound APIs.
- `line-mcp-operations`: Tenant-scoped LINE conversation and messaging operations exposed through the existing Open333CRM MCP endpoint.

### Modified Capabilities

- `line-messaging`: Add retry-safe behavior and delivery metadata requirements to the existing LINE sending strategies.

## Impact

- `packages/channel-plugins/src`: `ChannelPlugin` and `OutboundPayload` typed delivery metadata extensions.
- `packages/channel-plugins/src/line`: outbound LINE client, 409 accepted request ID handling, and delivery metadata.
- `apps/api/src/modules/marketing`: broadcast execution attempt persistence and chunk-level retry-key handling.
- `apps/api/src/modules/mcp`: LINE MCP tools, 2-phase confirmation flow, scopes, and tenant binding.
- `apps/api/src/modules/auth`: `getAgentById` parameter type relaxation to `TenantDb` for clean MCP server construction.
- `packages/database/prisma/schema.prisma`: tenant-scoped broadcast delivery-attempt model with RLS.
- `scripts/check-tenant-scoping.mjs`: register the new model in `TENANT_MODELS`.
- `apps/api/src/__tests__` and relevant channel/marketing tests: retry, authorization, tenant isolation, and idempotency coverage.
- `CHANGELOG.md`: update the latest date-only release section when implementation is completed.

