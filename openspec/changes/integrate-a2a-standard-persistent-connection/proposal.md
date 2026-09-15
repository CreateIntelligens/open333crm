## Why

Open333CRM currently has no first-class connection to the hosted 888a2a-lite
Agent-to-Agent service. The project needs to participate as a standard A2A
HTTP+JSON agent with a long-lived streaming connection so peer tasks can be
received, processed by the existing tenant-scoped Agent runtime, and answered
reliably after reconnects or process restarts.

## What Changes

- Add a standard A2A HTTP+JSON client for the hosted Gateway at
  `https://a2a.david888.com/a2a/v1`.
- Use Agent Card discovery and standard A2A message/task operations for the data
  plane, including streaming responses and task subscription.
- Add a registration bootstrap flow using `/hub/v1/agents/register`; use the
  supplied `X-Hub-Key` only during registration or key rotation, then use the
  issued Agent Token for standard A2A requests.
- Add a long-lived A2A bridge that maintains the streaming connection, handles
  heartbeat/keepalive, reconnect backoff, resume state, graceful shutdown, and
  duplicate task delivery.
- Route inbound A2A messages to an explicitly configured Open333CRM tenant and
  invoke the existing bounded Agent runner through a tenant-safe application
  boundary.
- Return completed or failed task results through the standard A2A Gateway and
  preserve bounded audit information without storing Hub credentials or
  untrusted payloads indefinitely.
- Add configuration, health/observability, contract tests, reconnect tests,
  authentication tests, and tenant-isolation tests.
- Do not copy or serve `llms.txt` from this repository. Do not build, run, or
  deploy an A2A Hub server. Do not use legacy `/hub/v1` task delivery for the
  standard data plane.

## Capabilities

### New Capabilities

- `a2a-standard-persistent-connection`: Standard A2A Gateway discovery,
  authentication, task/message streaming, persistent connection lifecycle,
  reconnect/resume, and reliable result delivery.
- `a2a-agent-tenant-routing`: Explicit mapping between A2A Agent identity and
  Open333CRM tenant context, including credential ownership, inbound validation,
  and tenant-safe execution boundaries.

### Modified Capabilities

- `agentic-llm-orchestration`: Permit A2A-originated text tasks to use the same
  bounded, auditable Agent execution rules as CRM-originated requests, while
  preserving existing tool allowlists, quotas, and tenant isolation.

## Impact

- New A2A client/bridge code, likely under a reusable package and a separate
  long-running process rather than inside the Fastify request lifecycle.
- `apps/api` Agent invocation boundary and authentication/health endpoints.
- `apps/workers` or a dedicated bridge runtime for durable background work.
- Environment/deployment secrets for Hub bootstrap key, Agent ID, Agent Token,
  and tenant mapping; no secret is committed to the repository.
- Possible persistence for connection cursor/task idempotency, subject to the
  design decision between Redis/BullMQ and a dedicated database record.
- No new public CRM channel is required for the initial text-task bridge; CRM
  conversation/channel modeling remains outside this change unless explicitly
  added during design review.
