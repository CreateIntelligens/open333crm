# Design

## Context

Open333CRM already owns LINE webhook ingestion, the unified `ChannelPlugin` interface, scheduled broadcast execution in the API process (`apps/api/src/modules/marketing`), tenant-bound Prisma access, and the `/mcp` Streamable HTTP endpoint. The existing LINE plugin sends directly with `fetch`, while the existing MCP server exposes read-only CRM tools and currently passes a base Prisma client to its service factory. The relevant behavior contracts are in the `line-messaging`, `line-safe-reply`, `line-webhook-events`, `channel-plugins`, and `rbac` specs.

The remote L Harness implementation is used as a reference for retry keys, typed LINE API errors, request IDs, and LINE-specific MCP tool organization. Its Cloudflare Worker/D1 runtime and database are not part of this design.

## Goals / Non-Goals

**Goals:**

- Make supported outbound LINE API calls safe to retry after timeouts or uncertain upstream results.
- Preserve one logical CRM delivery record for a retried operation.
- Expose useful LINE operations through the existing tenant-aware MCP endpoint.
- Keep MCP writes behind explicit scopes, RBAC, 2-phase confirmation, quota checks, and audit records.
- Reuse existing credentials, channel plugin behavior, broadcast workflow, and Socket.IO routing.

**Non-Goals:**

- Importing or running the remote Worker, D1 schema, Pages dashboard, or standalone SDK as a second CRM runtime.
- Adding a second LINE webhook endpoint or allowing two systems to own the same LINE channel.
- Replacing the existing `line-safe-reply` timeout and fallback rules.
- Implementing the remote repository's affiliate, traffic-pool, BAN migration, booking, or LIFF product surface.
- Returning channel secrets, access tokens, or raw credential fields through MCP.

## Decisions

### 1. Extend the existing LINE channel boundary

Add a typed request helper inside the existing LINE channel plugin boundary.
- Extend `OutboundPayload.delivery` in `packages/channel-plugins/src/index.ts` with optional `retryKey?: string`.
- Extend `ChannelPlugin.sendMessage` return type with optional `requestId?: string`.
- The helper will normalize successful responses (capturing `x-line-request-id`), map non-success responses to structured errors, and attach retry keys only to Push, Multicast, Narrowcast, and Broadcast requests.
- When LINE returns **HTTP 409 Conflict** for a repeated request with an existing `X-Line-Retry-Key`, the helper will treat it as an idempotent success and extract the prior accepted identifier from the `x-line-accepted-request-id` header (falling back to `x-line-request-id`).
- LINE retains retry keys for **24 hours**. Attempts past 24 hours cannot rely on upstream deduplication and must be surfaced to operators rather than blindly resent with the same key.

Alternative considered: add `@line-harness/sdk` as a dependency. Rejected because that SDK targets the remote service's API and data model, while Open333CRM already owns the LINE API boundary.

### 2. Use a stable logical operation identity

The caller will create or reuse a UUID for each logical delivery operation before the first supported LINE API request.
- **Individual outbound messages**: Use the pre-created CRM message ID (`message.id`, UUID) as the retry key, and record `lineRequestId` in `message.metadata`.
- **Broadcast execution**: In `apps/api/src/modules/marketing/marketing.service.ts` (`executeBroadcast`), each multicast batch chunk (≤499 recipients) creates a tenant-scoped `BroadcastDeliveryAttempt` record with a deterministic UUID retry key, batch index, and status. Retrying an interrupted or failed broadcast reuses that batch attempt's retry key and updates its status and request ID without duplicating user deliveries.

The attempt record will be tenant-scoped and will retain the retry key, LINE request ID, batch identity, and final status. If an existing JSON metadata field can hold the same durable information without weakening queryability or auditability, the implementation may reuse it for individual messages; broadcast batch attempts remain explicit records in `broadcast_delivery_attempts`.

Alternative considered: generate a new random retry key on every retry. Rejected because LINE would treat each retry as a new logical request and could deliver duplicates.

### 3. Keep reply delivery separate

Reply calls will continue through the existing safe-reply path. They will not use retry keys because LINE retry-key support applies to Push, Multicast, Narrowcast, and Broadcast APIs. A late or failed reply continues to fall back to Push according to `line-safe-reply`.

### 4. Bind MCP data access to the request tenant

The MCP route will authenticate the CLI session first, then construct the MCP server with the request's tenant-scoped Prisma executor (`request.tenantPrisma`).
- Relax `getAgentById` in `apps/api/src/modules/auth/auth.service.ts` from `prisma: PrismaClient` to `prisma: TenantDb` so `TenantScopedClient` compiles cleanly.
- New LINE tools will receive that executor and an immutable actor context containing agent ID, tenant ID, role, and CLI scopes.
- Authentication and CLI-session verification remain on the admin/auth path. Tenant data reads and writes use `request.tenantPrisma` or an explicit `withTenant` transaction, following the RLS skill's rule that queries must execute on the same transaction that sets `app.current_tenant`.

Alternative considered: keep passing `fastify.prisma` and add `tenantId` filters in each MCP service. Rejected because it leaves an RLS connection-binding gap and makes future tools easy to implement incorrectly.

### 5. Split MCP scopes by side effect & require 2-phase confirmation

Keep `mcp:read` as the baseline scope. Add separate scopes:
- `mcp:line:read`: search contacts, list LINE conversations, inspect delivery status.
- `mcp:line:send`: send direct messages to tenant-visible LINE contacts.
- `mcp:line:broadcast`: initiate broadcasts on tenant LINE channels.

**2-Phase Confirmation Protocol**:
To prevent automated LLM hallucinated writes, write tools require explicit confirmation:
- **Phase 1 (Preview / Dry Run)**: Invocation without a valid `confirmationToken` verifies scopes, RBAC, target existence, and returns `{ status: "PENDING_CONFIRMATION", summary: { channelId, recipientCount, textPreview, ... }, confirmationToken: "<signed-token>" }` without dispatching messages.
- **Phase 2 (Confirmed Execution)**: Invocation with `{ confirmationToken, confirm: true }` verifies the token (validating tenant, actor, target match, and short expiration window) and executes the write.

Direct send tools accept either `conversationId` or `(channelId, contactId)` (resolving or creating the active conversation), then dispatch through `createMessage`. Broadcast tools create or invoke the existing marketing broadcast workflow (`createBroadcast` / `executeBroadcast`) so quota checks and recipient records remain authoritative.

### 6. Audit MCP writes through existing tenant audit infrastructure and wire Socket.IO

Each accepted, rejected, or failed MCP write records the tenant, actor, CLI session, operation name, target identifiers, confirmation state, and outcome. Credentials and full message secrets are excluded from audit payloads.
- Pass `fastify.io` as an optional parameter `io?: SocketIOServer` into `createMcpServer`.
- Direct sends invoke `createMessage` with `io`, emitting `message.new` to the conversation room and tenant room in real time.

### 7. Enforce RLS and validate with focused isolation tests

- Model `BroadcastDeliveryAttempt`:
  - Fields: `id`, `tenantId`, `broadcastId`, `batchIndex`, `retryKey`, `lineRequestId`, `status`, `error`, `createdAt`, `updatedAt`.
  - Postgres RLS: `ENABLE` and `FORCE ROW LEVEL SECURITY`.
  - Policy: `USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)`.
  - Register `broadcastDeliveryAttempt` in `TENANT_MODELS` in `scripts/check-tenant-scoping.mjs`.
  - Migration must run using table owner connection (`MIGRATE_DATABASE_URL`).
- Tests will cover LINE client error mapping, retry-key reuse, HTTP 409 accepted retries (`x-line-accepted-request-id`), multicast batch identity, MCP scope/RBAC/confirmation checks, cross-tenant object access, audit redaction, and broadcast quota rejection. Existing RLS isolation, safe-reply, webhook, and broadcast tests remain regression gates.

## Risks / Trade-offs

- **[Risk]** A retry key can only make supported LINE API requests idempotent; it cannot guarantee final user delivery. → **Mitigation:** retain the upstream status, request ID, and final CRM delivery status, and surface unresolved failures for operator retry.
- **[Risk]** Adding broadcast attempt records increases schema and migration surface. → **Mitigation:** make the attempt identity the only new delivery state required, add tenant RLS in the same migration with `NULLIF(..., '')::uuid`, register in `check-tenant-scoping.mjs`, and test migration before deployment.
- **[Risk]** MCP write tools can send real customer messages. → **Mitigation:** separate scopes, enforce RBAC and tenant/channel visibility, require 2-phase confirmation with signed tokens, apply existing quota/audience validation, and audit every outcome.
- **[Risk]** MCP work may expose the current base-client RLS gap. → **Mitigation:** switch the MCP server factory to `request.tenantPrisma`, adjust `getAgentById` parameter type to `TenantDb`, and run an RLS integration test for every new tool.
- **[Risk]** Direct MCP sends and normal UI sends could race. → **Mitigation:** reuse existing message idempotency/client-message identifiers and channel delivery services instead of adding a parallel sender.

## Migration Plan

1. Add the typed LINE request helper and tests without changing MCP behavior.
2. Add the tenant-scoped broadcast delivery-attempt model/migration, RLS policy, `scripts/check-tenant-scoping.mjs` registration, and persistence path.
3. Route supported LINE sends through retry-aware delivery and verify existing broadcast and safe-reply tests.
4. Update `getAgentById` parameter type to `TenantDb`, switch MCP server construction to `request.tenantPrisma`, inject `io`, and preserve existing read-only tool behavior.
5. Add read-only LINE MCP tools, then add direct-send and broadcast tools behind 2-phase confirmation and disabled-by-default scopes until authorization tests pass.
6. Enable the scopes for controlled CLI sessions, run tenant-isolation and duplicate-send checks, then document the capability in the changelog.

Rollback is capability-scoped: revoke the new CLI scopes, disable the new MCP write tools, and route outbound calls back through the previous LINE client while retaining the additive delivery-attempt records. Database rollback is reserved for a migration failure and follows the repository migration procedure.

