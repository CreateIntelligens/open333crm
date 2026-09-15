## Context

See `proposal.md` for motivation and scope. The current project has a bounded
Agent runner under `apps/api/src/modules/ai/agent`, existing tenant-aware
database helpers, BullMQ/Redis infrastructure, and a separate worker process.
It has no A2A client, stream supervisor, Agent credential store, or A2A tenant
binding.

The hosted service exposes a standard A2A HTTP+JSON interface from its Agent
Card, while registration is a separate Hub bootstrap operation. Its live
system card currently reports standard A2A enabled but also reports a pending
CI gate. The bridge therefore needs a strict standard capability preflight and
must fail closed when the advertised standard interface is not usable.

## Goals / Non-Goals

**Goals:**

- Make Open333CRM a standard A2A HTTP+JSON participant.
- Keep a logically always-on connection through a supervised long-lived stream
  with automatic reconnect and task reconciliation.
- Preserve at-least-once delivery without duplicate LLM execution or duplicate
  task results.
- Reuse the existing bounded Agent execution and audit rules.
- Keep tenant mapping explicit and enforce the existing two-layer tenant
  isolation model.

**Non-Goals:**

- Serving, compiling, deploying, or operating an A2A Hub.
- Copying, serving, or periodically synchronizing `llms.txt`.
- Using legacy `/hub/v1` inbox/task routes for standard data-plane traffic.
- Treating A2A as a new public CRM channel in the first implementation.
- Allowing peer messages to grant shell execution, admin access, or new tools.
- Supporting non-text A2A parts until the Gateway contract and local handling
  are explicitly extended.

## Decisions

### D1. Standard Gateway data plane with Hub registration bootstrap

Use the Agent Card's advertised standard HTTP+JSON interface for discovery,
message sending, streaming, and task observation. Use the Hub registration
endpoint only to create or rotate the Agent identity. The Hub key is injected
at runtime as `A2A_HUB_KEY` from `.env` in local development or a deployment
secret manager in production. It is never used as a normal request token.

**Alternative considered:** use the legacy `/hub/v1` inbox and task endpoints
because they document SSE and ACK in more detail. Rejected because this change
explicitly requires the standard A2A protocol; any missing standard behavior
must be resolved with the Gateway contract rather than silently switching
protocols.

### D2. Dedicated long-running bridge process

Run the persistent stream supervisor in a dedicated bridge runtime, with a
reusable client package for HTTP+JSON and SSE/task subscription behavior. The
Fastify request lifecycle is not suitable for a connection that must survive
individual requests, and the existing API event bus is process-local.

The bridge owns connection state, queue handoff, reconnect backoff, task
reconciliation, and result retry. It communicates with Open333CRM through a
private authenticated application boundary or a shared service module whose
database access is explicitly tenant-scoped.

**Alternative considered:** put the stream in `apps/api`. Rejected because API
replicas would create competing listeners and because a request process restart
would couple A2A availability to HTTP traffic.

### D3. Durable queue before Agent execution

Persist a bounded task receipt and enqueue work before starting model execution.
Use stable A2A task identity plus context identity as the idempotency key. A
completed result is persisted before retrying delivery, so a delivery failure
does not rerun the Agent.

The queue must survive bridge restarts and expose retry/dead-letter state. The
implementation may reuse the repository's Redis/BullMQ deployment, but it must
not use the cross-tenant admin client as a substitute for tenant-scoped Agent
execution.

### D4. Logical permanent connection, not an unbreakable socket

“永久連線” means a continuously supervised connection lifecycle:

```text
DISCONNECTED → DISCOVERING → CONNECTING → STREAMING
                                  │          │
                                  │          └─ disconnect/error
                                  │                    ↓
                                  └──── backoff ← RECONCILING
```

The bridge uses bounded exponential backoff with jitter, keepalive detection,
controlled cancellation, and standard task get/list/subscribe reconciliation.
No implementation may busy-loop or assume one TCP connection lasts forever.

### D5. One explicit tenant binding per bridge identity

The first rollout binds one A2A Agent identity to one active tenant. The bridge
must reject startup when the mapping is absent or ambiguous. Multi-tenant
operation requires a later design for one identity per tenant or a trusted
platform dispatcher; a shared `X-Hub-Key` circle is not a tenant boundary.

### D6. A2A tasks are Agent runs, not CRM channel messages

An inbound A2A text task invokes the existing Agent runtime with a tenant
context and produces an A2A result. It does not create a synthetic contact,
conversation, or channel in the initial implementation. If CRM history or
customer-channel delivery is required later, it needs a separate channel and
conversation design with its own idempotency and authorization rules.

## Risks / Trade-offs

- **[Risk] Standard Gateway contract is advertised while its CI gate remains pending.** → Require a startup preflight, fail closed, and keep standard contract tests against a mock Gateway before production enablement.
- **[Risk] SSE disconnects can produce at-least-once duplicate observations.** → Persist task identity, gate active execution by idempotency, and reconcile task state before retrying.
- **[Risk] One Agent identity is accidentally shared by multiple tenants.** → Require an unambiguous deployment binding and reject runtime tenant IDs supplied by peers.
- **[Risk] A2A peer content contains prompt injection or sensitive data.** → Treat all peer content as untrusted, retain bounded redacted payloads, and reuse existing tool allowlists and Agent guards.
- **[Risk] Redis/BullMQ outage interrupts the stream handoff.** → Do not mark work as accepted until durable handoff succeeds; retain connection health as degraded and retry without acknowledging completion.
- **[Risk] Long-running bridge is deployed as a normal API replica.** → Give it a separate process identity, singleton/lease policy, health endpoint, and deployment restart policy.

## Migration Plan

1. Add disabled-by-default configuration and secret placeholders only; no
   connection starts until the feature flag and tenant binding are valid.
2. Deploy the bridge in observe-only/preflight mode to verify Agent Card,
   standard interface, credentials, tenant mapping, and stream health.
3. Enable inbound task processing for one explicitly selected tenant with
   text-only tasks and bounded concurrency.
4. Verify reconnect, duplicate delivery, result retry, credential rotation,
   tenant isolation, and graceful shutdown before increasing traffic.
5. Roll back by disabling the bridge feature and stopping the bridge process;
   retain task records for diagnosis and do not delete credentials or audit
   state during rollback.

## Resolved Pre-Implementation Decisions

- The standard Gateway's exact task-subscription event schema and task-result
  submission shape SHALL be pinned from the live Agent Card and its referenced
  standard source contract before implementation. The implementation MUST NOT
  infer those fields from the legacy `/hub/v1` API. This is an explicit first
  implementation task and a prerequisite for enabling the bridge.
- Registration SHALL be a controlled one-shot bootstrap operation. It may use
  `A2A_HUB_KEY` to create or rotate the Agent identity, then the operator SHALL
  place the returned `A2A_AGENT_ID` and `A2A_AGENT_TOKEN` in the deployment
  secret manager. The long-running bridge SHALL read only those credentials and
  SHALL never need `A2A_HUB_KEY` during ordinary operation. Replacing the Hub
  key SHALL require updating the runtime secret and explicitly rerunning the
  bootstrap/rotation operation; it SHALL not trigger on every bridge restart.
