## Why

Open333CRM currently has no first-class connection to the hosted 888a2a-lite
Agent-to-Agent service. The project needs to participate as a standard A2A
HTTP+JSON agent with a long-lived streaming connection so peer tasks can be
received, processed by the existing tenant-scoped Agent runtime, and answered
reliably after reconnects or process restarts.

## What Changes

- Integrate the existing official `a2a-bridge` / `a2a bridge` runtime as the
  A2A transport boundary instead of reimplementing Hub HTTP/SSE in
  Open333CRM.
- Use the bridge's durable inbox, long-lived `/hub/v1` SSE, Instant ACK,
  reconnect, and standard A2A task/result correlation; Open333CRM receives a
  local prompt/backend invocation rather than raw Hub HTTP events.
- Add a registration bootstrap flow using `/hub/v1/agents/register`; use the
  supplied `X-Hub-Key` only during registration or key rotation, then use the
  issued Agent Token for standard A2A requests.
- Add an Open333CRM bridge backend adapter/CLI entrypoint that the official
  bridge can invoke for prompt execution and response delivery.
- Route inbound A2A messages to an explicitly configured Open333CRM tenant and
  invoke the existing bounded Agent runner through a tenant-safe application
  boundary.
- Return completed or failed task results through the standard A2A Gateway and
  preserve bounded audit information without storing Hub credentials or
  untrusted payloads indefinitely.
- Replace hidden module-level feature tabs with an explicit, URL-based
  dashboard tree menu. Make Knowledge Base areas directly reachable instead of
  requiring users to open Knowledge Base and then find `Chat & Prompt` as the
  fifth tab.
- Inventory all dashboard routes and nested module navigation, define a single
  information architecture, preserve useful data-filter tabs, and add visible
  permission-aware active states and responsive tree behavior.
- Add a visible Settings > Integrations > A2A destination for connection
  health and non-secret configuration status; never expose the Hub key in the
  browser.
- Add configuration, health/observability, contract tests, reconnect tests,
  authentication tests, and tenant-isolation tests.
- Do not copy or serve `llms.txt` from this repository. Do not build, run, or
  deploy an A2A Hub server. Do not reimplement the bridge's transport layer in
  the CRM API.

## Capabilities

### New Capabilities

- `a2a-standard-persistent-connection`: Official bridge-owned persistent Hub
  connection, standard A2A task/result correlation, local prompt handoff,
  reconnect/resume, and reliable result delivery.
- `a2a-agent-tenant-routing`: Explicit mapping between A2A Agent identity and
  Open333CRM tenant context, including credential ownership, inbound validation,
  and tenant-safe execution boundaries.
- `dashboard-tree-navigation`: A permission-aware, responsive, URL-based tree
  menu that exposes all dashboard modules and nested destinations without
  hiding primary features behind deep tab stacks.
- `knowledge-base-information-architecture`: Direct routes and navigation for
  Knowledge Base content, search, feedback, embedding, and Chat & Prompt
  configuration.

### Modified Capabilities

- `agentic-llm-orchestration`: Permit A2A-originated text tasks to use the same
  bounded, auditable Agent execution rules as CRM-originated requests, while
  preserving existing tool allowlists, quotas, and tenant isolation.

## Impact

- New bridge adapter/CLI code and bridge deployment wiring; the official
  a2a-bridge remains the long-running transport process.
- `apps/api` Agent invocation boundary and authentication/health endpoints.
- `apps/workers` or a dedicated bridge runtime for durable background work.
- Environment/deployment secrets for Hub bootstrap key, Agent ID, Agent Token,
  and tenant mapping; no secret is committed to the repository.
- Possible persistence for connection cursor/task idempotency, subject to the
  design decision between Redis/BullMQ and a dedicated database record.
- No new public CRM channel is required for the initial text-task bridge; CRM
  conversation/channel modeling remains outside this change unless explicitly
  added during design review.
