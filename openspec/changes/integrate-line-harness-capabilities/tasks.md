# Tasks

## 1. Contracts and delivery state

- [x] 1.1 Define the CLI scopes (`mcp:line:read`, `mcp:line:send`, `mcp:line:broadcast`), `ChannelPlugin` extension (`delivery.retryKey?: string`, return `requestId?: string`), 2-phase MCP confirmation schema (preview/token vs confirm/token), audit outcome shape, and LINE delivery metadata constants; verify types compile and existing channel plugins remain compatible
- [x] 1.2 Add the tenant-scoped broadcast delivery-attempt Prisma model (`BroadcastDeliveryAttempt`) with retry key, batch identity, LINE request ID, status, and error metadata; add the migration with `ENABLE`/`FORCE ROW LEVEL SECURITY` using `NULLIF(current_setting('app.current_tenant', true), '')::uuid`, register `broadcastDeliveryAttempt` in `TENANT_MODELS` inside `scripts/check-tenant-scoping.mjs`, and verify Prisma generation and `scripts/check-tenant-scoping.mjs --strict`
- [x] 1.3 Normalize `openspec/specs/line-messaging/spec.md` into the repository's main-spec structure (`#`, `## Purpose`, `## Requirements`) without changing its existing behavior; verify `openspec validate line-messaging --type spec` and `openspec validate integrate-line-harness-capabilities` pass

## 2. Retry-safe LINE delivery

- [x] 2.1 Implement the typed LINE request helper in `packages/channel-plugins/src/line`; verify success responses expose `x-line-request-id`, HTTP 409 conflict responses are treated as idempotent success with `x-line-accepted-request-id` (falling back to `x-line-request-id`), non-success responses expose status/body details, and retry keys are attached only to supported APIs
- [x] 2.2 Add unit tests for retry-key reuse, original-payload preservation, HTTP 409 accepted retries using `x-line-accepted-request-id`, 24-hour key retention handling, upstream error mapping, and reply requests without retry keys; verify the focused LINE plugin test command passes
- [x] 2.3 Wire direct outbound message delivery in `conversation.service.ts` to use `message.id` as the logical UUID operation identity before the first supported LINE request and persist `lineRequestId` in `message.metadata` without creating duplicate CRM messages; verify duplicate-send regression tests pass
- [x] 2.4 Wire broadcast execution in `apps/api/src/modules/marketing/marketing.service.ts` (`executeBroadcast`) to persist one `BroadcastDeliveryAttempt` identity per multicast batch chunk (≤499 recipients) and reuse it across broadcast retries/re-runs; verify recipient counts, success/failure counts, and request IDs remain correct after a simulated timeout without duplicate user sends
- [x] 2.5 Run the existing safe-reply, LINE messaging, broadcast, and webhook test suites; verify reply-token fallback and non-LINE channel behavior remain unchanged

## 3. Tenant-bound MCP foundation

- [x] 3.1 Relax `getAgentById` parameter type in `apps/api/src/modules/auth/auth.service.ts` to `TenantDb`; update `createMcpServer` to accept `request.tenantPrisma`, `request.agent`, and `io?: SocketIOServer`; verify all existing CRM MCP tools pass tenant-isolation tests and no tool uses the module-level Prisma singleton
- [x] 3.2 Add per-operation scope checks for LINE read (`mcp:line:read`), direct send (`mcp:line:send`), and broadcast initiation (`mcp:line:broadcast`) while preserving the baseline `mcp:read` requirement; verify missing and insufficient scopes return the standard 403 error without side effects
- [x] 3.3 Add tenant-scoped MCP audit helpers that redact channel credentials and sensitive message fields; verify accepted, rejected, and failed write attempts record actor, tenant, CLI session, target, and outcome

## 4. LINE MCP operations

- [x] 4.1 Add read-only tools for listing/searching LINE conversations and contacts plus retrieving broadcast delivery status; verify pagination, tenant filters, channel visibility, and read-only annotations
- [x] 4.2 Add a 2-phase confirmed direct-send tool (`crm_line_direct_send`) accepting `conversationId` or `(channelId, contactId)`: phase 1 returns audience/message preview and signed confirmation token; phase 2 validates token, dispatches through `createMessage` with `io`, records retry metadata, and emits real-time events
- [x] 4.3 Add a 2-phase confirmed broadcast-initiation tool (`crm_line_broadcast_initiate`): phase 1 returns quota and audience preview with confirmation token; phase 2 validates token and initiates the marketing broadcast workflow (`createBroadcast`/`executeBroadcast`) with authoritative quota and audit records
- [x] 4.4 Add MCP route integration tests for allowed origins, CLI session scopes, cross-tenant object IDs, direct-send rejection, broadcast quota rejection, and successful 2-phase confirmed operations

## 5. Verification and release readiness

- [x] 5.1 Run the RLS integration test with two tenants and verify delivery attempts, MCP reads, direct sends, and broadcasts cannot cross tenant boundaries; run `scripts/check-tenant-scoping.mjs --strict` and `scripts/check-prisma-admin-usage.mjs --strict`
- [x] 5.2 Run `pnpm build`, relevant API/channel tests, `node scripts/check-workspace-esm.mjs --strict`, `openspec validate integrate-line-harness-capabilities`, and `openspec validate line-messaging --type spec`
- [x] 5.3 Update `CHANGELOG.md` under the latest date-only release heading with the new LINE retry reliability and MCP capabilities; verify no `## [Unreleased]` heading is introduced
- [ ] 5.4 Perform a deployment rehearsal with one test LINE channel, verify webhook ownership remains exclusively Open333CRM, simulate a timeout/retry, and confirm exactly one user-visible message is delivered

