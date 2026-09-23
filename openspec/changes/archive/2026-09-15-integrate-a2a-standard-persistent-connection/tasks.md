## 1. Official bridge contract and secure bootstrap

- [x] 1.1 Pin the official `a2a-bridge` source entrypoints and its local CommandBackend/stdin-stdout contract in the integration runbook; verify the selected bridge owns Hub SSE, durable enqueue, Instant ACK, reconnect, anti-echo, and standard A2A result correlation.
- [x] 1.2 Define feature-gated CRM adapter configuration for API host, CLI profile, tenant binding, prompt size, timeout, and retry behavior; verify missing or invalid values fail closed without logging Hub keys, Agent Tokens, or prompt contents.
- [x] 1.3 Document the one-shot official bridge registration/rotation flow using `A2A_HUB_KEY` from runtime environment, then storing `A2A_AGENT_ID`/`A2A_AGENT_TOKEN` in deployment secrets; verify the CRM adapter never receives the Hub key.

## 2. Open333CRM bridge backend adapter

- [x] 2.1 Add an `open333 a2a:execute` CLI command that accepts one bounded bridge prompt from stdin or an explicit argument and returns only the Agent result text on stdout; verify empty, oversized, and malformed input is rejected without shell evaluation.
- [x] 2.2 Reuse the existing authenticated Open333 CLI profile/token path to invoke the tenant Agent endpoint; verify the adapter preserves tenant identity, existing Agent guards, and non-zero failure behavior.
- [x] 2.3 Add a bridge integration runbook and process command using the official `a2a bridge --backend command --backend-cmd ...` mode; verify the bridge can hand a prompt to Open333CRM without exposing raw Hub protocol details to the CRM Agent.

## 3. Bridge-owned long-lived connection integration

- [x] 3.1 Add explicit bridge process configuration, health/readiness reporting, and process supervision separate from Fastify replicas; verify only the official bridge owns the persistent Hub connection.
- [x] 3.2 Add CRM adapter idempotency for task/context identifiers and repeated stdin delivery; verify a bridge reconnect or retry cannot start duplicate active Agent runs.
- [x] 3.3 Verify official bridge reconnect, durable queue recovery, Instant ACK ordering, anti-echo suppression, and standard A2A correlated result delivery using the upstream test fixture or a local bridge fixture.
- [x] 3.4 Add graceful shutdown behavior for the CRM adapter and bridge command invocation; verify in-flight prompts return bounded failures and the official bridge retains retryable work.

## 4. Durable task processing and result delivery

- [x] 4.1 Define the local bridge-to-CRM handoff as a single prompt/response invocation; verify durable receipt and standard task state remain owned by the official bridge.
- [x] 4.2 Add bounded timeout and retry classification for CLI/API invocation; verify a retryable CRM failure does not cause the adapter to fabricate an A2A reply or bypass the bridge outbox.
- [x] 4.3 Route accepted prompts into the existing bounded Agent runner through the authenticated CLI path; verify existing turn, token, tool-call, quota, and audit guards remain active.
- [x] 4.4 Verify final text, `[[A2A_NO_REPLY]]`, and bounded failure markers are returned exactly as required by the official bridge backend contract.

## 5. Tenant isolation and security validation

- [x] 5.1 Enforce one explicit active tenant binding per bridge identity and reject tenant IDs supplied by peer messages or Agent Cards; verify cross-tenant identifiers cannot read, write, or invoke tools against another tenant.
- [x] 5.2 Add secret redaction, bounded task retention, prompt-injection handling, and safe logging rules; verify Hub keys, Agent Tokens, authorization headers, stack traces, and unrestricted peer payloads never appear in logs or audit records.
- [x] 5.3 Add duplicate delivery, reconnect, authentication, unsupported-content, and tenant-isolation tests; verify all A2A-related tests pass without requiring a live Hub credential.

## 6. Deployment and rollout verification

- [x] 6.1 Add a dedicated bridge process definition, health/readiness behavior, and restart policy separate from Fastify API replicas; verify multiple API replicas do not create competing persistent A2A listeners.
- [x] 6.2 Run preflight/observe-only validation against the configured standard Gateway and one selected tenant; verify Agent Card discovery, standard stream subscription, health reporting, and credential handling before task execution is enabled.
- [x] 6.3 Run repository validation, tenant-scoping checks, build/typecheck, and the A2A contract suite; verify the feature remains disabled by default and existing CRM Agent behavior is unchanged when the bridge is stopped.
- [x] 6.4 Update `CHANGELOG.md` under the latest date-only release heading when implementation is completed; verify no `## [Unreleased]` heading or secret value is added.

## 7. Dashboard navigation inventory and tree architecture

- [x] 7.1 Inventory every current dashboard route, detail route, sidebar item, module tab, settings tab, placeholder item, permission guard, and global destination in `docs/integrations/dashboard-navigation-inventory.md`; verify the route matrix has no orphaned or unclassified user-facing route.
- [x] 7.2 Define canonical URL paths and migration redirects for Knowledge Base, Marketing, LINE, Settings, Analytics, Portal, Shortlinks, Notifications, Plan, and all detail pages; verify legacy URLs and tab query parameters preserve intended destinations.
- [x] 7.3 Define the permission-aware tree topology, labels, grouping, active ancestor rules, and distinction between feature-navigation tabs and data-filter tabs; verify every tree node maps to a canonical route and required permission.
- [x] 7.4 Replace Knowledge Base module tabs with direct tree destinations for Articles, Semantic Search, Feedback, Embedding, and Chat & Prompt; verify Chat & Prompt opens directly without passing through Article Management.
- [x] 7.5 Replace other module-level navigation tabs and flat Settings state with route-based tree destinations while retaining justified local filter tabs; verify Marketing, LINE, Settings, and Analytics navigation remains consistent.
- [x] 7.6 Add Settings > Integrations > A2A status destination with connection state, masked Agent identity, tenant binding state, and safe error information; verify Hub key and Agent Token never reach browser-rendered data.
- [x] 7.7 Implement responsive and accessible tree interaction for desktop, keyboard, and mobile drawer states; verify focus management, expand/collapse semantics, touch targets, active states, and deep-link refresh behavior.
- [x] 7.8 Add route/navigation tests and browser verification for direct links, refresh, back/forward navigation, permission filtering, mobile navigation, and legacy redirects; verify no feature is reachable only through an undocumented tab state.
