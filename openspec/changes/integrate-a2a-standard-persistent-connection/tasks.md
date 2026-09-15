## 1. Standard A2A contract and secure bootstrap

- [ ] 1.1 Pin the live Agent Card, supported HTTP+JSON protocol version, stream/task-subscription event schema, message shape, and result/error shape in a versioned contract fixture; verify every field used by the bridge is sourced from the standard contract and none is copied from legacy `/hub/v1` behavior.
- [ ] 1.2 Define feature-gated runtime configuration for `A2A_GATEWAY_URL`, `A2A_HUB_KEY`, `A2A_AGENT_ID`, `A2A_AGENT_TOKEN`, tenant binding, connection limits, retry limits, and task retention; verify missing or invalid values fail closed at startup without logging secrets and that `.env.example` contains placeholders only.
- [ ] 1.3 Add a one-shot registration/rotation bootstrap operation that reads `A2A_HUB_KEY`, sends it as `X-Hub-Key` only to the Hub registration endpoint, returns masked identity metadata, and documents storing the resulting `A2A_AGENT_ID`/`A2A_AGENT_TOKEN` in deployment secrets; verify ordinary bridge requests contain no Hub key.

## 2. Standard A2A client

- [ ] 2.1 Implement typed Agent Card discovery and standard interface validation; verify unsupported protocol versions, non-HTTPS Gateway URLs, and missing required capabilities are rejected with actionable health errors.
- [ ] 2.2 Implement Bearer Agent Token HTTP+JSON calls for standard discovery, message, task, stream, and subscription operations; verify authorization headers, content types, bounded payloads, timeout handling, and standard error normalization with mocked Gateway responses.
- [ ] 2.3 Implement the standard streaming/task-subscription decoder with keepalive handling and cancellation; verify malformed events, unsupported content parts, and abrupt EOF do not crash the process or create phantom tasks.

## 3. Long-lived connection supervisor

- [ ] 3.1 Implement the bridge connection state machine for discovery, connecting, streaming, reconciling, degraded, and shutdown states; verify a successful stream remains active and publishes safe health state.
- [ ] 3.2 Implement bounded exponential reconnect backoff with jitter and reset-after-success behavior; verify repeated disconnects do not busy-loop or exceed configured upstream request rates.
- [ ] 3.3 Implement standard task reconciliation after reconnect and process restart using task get/list/subscribe operations; verify unfinished tasks resume observation without losing terminal results.
- [ ] 3.4 Implement graceful shutdown and process supervision hooks; verify termination stops new work, preserves recoverable tasks, closes streams/queues, and exits non-zero for unrecoverable authentication failure.

## 4. Durable task processing and result delivery

- [ ] 4.1 Add durable inbound task receipt and queue handoff using the repository's Redis/BullMQ infrastructure; verify persistence/enqueue completes before Agent execution and task identity prevents duplicate active jobs.
- [ ] 4.2 Add result-outbox state for completed and failed Agent outcomes; verify a transient Gateway failure retries result delivery without rerunning the completed Agent.
- [ ] 4.3 Add the private authenticated application boundary between the bridge and Open333CRM Agent runtime; verify the boundary accepts only the configured tenant binding, validates text-only input, and does not expose a public unauthenticated route.
- [ ] 4.4 Route accepted A2A tasks into the existing bounded Agent runner and return standard A2A text or failure outcomes; verify existing turn, token, tool-call, quota, and audit guards remain active.

## 5. Tenant isolation and security validation

- [ ] 5.1 Enforce one explicit active tenant binding per bridge identity and reject tenant IDs supplied by peer messages or Agent Cards; verify cross-tenant identifiers cannot read, write, or invoke tools against another tenant.
- [ ] 5.2 Add secret redaction, bounded task retention, prompt-injection handling, and safe logging rules; verify Hub keys, Agent Tokens, authorization headers, stack traces, and unrestricted peer payloads never appear in logs or audit records.
- [ ] 5.3 Add duplicate delivery, reconnect, authentication, unsupported-content, and tenant-isolation tests; verify all A2A-related tests pass without requiring a live Hub credential.

## 6. Deployment and rollout verification

- [ ] 6.1 Add a dedicated bridge process definition, health/readiness behavior, and restart policy separate from Fastify API replicas; verify multiple API replicas do not create competing persistent A2A listeners.
- [ ] 6.2 Run preflight/observe-only validation against the configured standard Gateway and one selected tenant; verify Agent Card discovery, standard stream subscription, health reporting, and credential handling before task execution is enabled.
- [ ] 6.3 Run repository validation, tenant-scoping checks, build/typecheck, and the A2A contract suite; verify the feature remains disabled by default and existing CRM Agent behavior is unchanged when the bridge is stopped.
- [ ] 6.4 Update `CHANGELOG.md` under the latest date-only release heading when implementation is completed; verify no `## [Unreleased]` heading or secret value is added.
