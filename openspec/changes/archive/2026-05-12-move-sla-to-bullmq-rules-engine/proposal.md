## Why

SLA polling currently exists in both the API process and the standalone worker path, which creates duplicate scan ownership and inconsistent notification behavior. SLA rule definitions also need a clear contract: packages define SLA-only events and conditions, the frontend composes rules from that contract, the API persists and validates rules, and workers scan cases then dispatch matched SLA events.

This change is intentionally scoped to SLA. Other service events such as `message.received`, sentiment analysis completion, or CSAT submission may provide facts that SLA rules read, but they are not part of this change's event catalog.

## What Changes

- Remove the API process SLA scanning startup path so `apps/api` no longer runs `setupSlaWorker()` timers.
- Make the standalone BullMQ `sla` worker the single owner of SLA warning, breach, first-response timeout, and customer-waiting scans.
- Change the SLA repeat job to the intended worker schedule and make its side effects flow through the async worker/socket path.
- Move shared SLA event definitions, condition metadata, facts, constants, and status/deadline helpers into packages consumed by API, workers, and web.
- Define the initial SLA event catalog as `sla.first_response.warning`, `sla.first_response.breached`, `sla.resolution.warning`, `sla.resolution.breached`, and `sla.customer_waiting.breached`.
- Treat sentiment risk as SLA-readable facts first; do not require this change to implement LLM sentiment detection or a separate non-SLA sentiment event pipeline.
- Let the frontend build SLA automation rules from package-defined events and condition metadata.
- Keep the API responsible for SLA policy CRUD and automation rule CRUD/validation, not background scanning.
- Add a rules-based SLA evaluation path that consumes frontend-authored rule JSON and evaluates it with `json-rules-engine`.
- Keep SLA side effects asynchronous: case events, priority/escalation updates, notifications, and socket emissions must be worker-safe and idempotent.
- Do not include nodemailer/SMTP email delivery in this change; email can be added in a later notification delivery change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `standalone-worker-runtime`: SLA polling becomes worker-owned only; API in-process scanning is removed, and the BullMQ SLA job is the authoritative scan trigger.
- `automation-engine`: Frontend-authored rule JSON is evaluated through `json-rules-engine` for SLA-related decisions instead of hand-coded condition branches.

## Impact

- Affected code:
  - `packages/shared/src/**` for SLA domain helpers, event names, condition metadata, and fact contracts used across API, worker, and web
  - `packages/automation/src/**` for worker-safe `json-rules-engine` evaluation
  - `apps/web/src/**` for frontend rule authoring from package-defined event/condition metadata
  - `apps/api/src/index.ts`
  - `apps/api/src/modules/automation/**`
  - `apps/api/src/modules/sla/sla.worker.ts`
  - `apps/workers/src/index.ts`
  - `apps/workers/src/handlers/sla.handler.ts`
- Affected runtime:
  - BullMQ `sla` queue
  - Redis socket bridge
  - notification queue path for SLA events
- Dependencies:
  - Uses the existing `json-rules-engine` dependency already present in automation-related packages.
  - Worker package should consume the shared rule engine module instead of owning a separate evaluator.
