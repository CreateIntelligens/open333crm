## Context

SLA monitoring currently has two execution paths. `apps/api` starts an in-process timer via `setupSlaWorker()`, while `apps/workers` also registers a repeating BullMQ job on the `sla` queue. The API path can publish in-process `eventBus` events, but the standalone worker cannot because `eventBus` is not cross-process. This creates split ownership and inconsistent notification behavior.

Automation rules are already persisted as JSON in `AutomationRule.conditions` and `AutomationRule.actions`, and the API automation service wraps `json-rules-engine`. The standalone automation worker path is less complete: it loads rules by `eventType` and executes actions without evaluating conditions. This change moves automation rule evaluation to the worker path so the API process only enqueues automation jobs after receiving in-process application events.

SLA itself is used by all three runtime surfaces:

- `apps/web` displays SLA countdowns, badges, policy forms, and rule-builder facts.
- `apps/api` creates cases, assigns policies, validates policy CRUD, and exposes SLA state through APIs.
- `apps/workers` scans cases, evaluates SLA rules, and dispatches side effects.

That shared domain logic should live in packages instead of being reimplemented in each app.

The target responsibility split is:

```txt
packages
  define SLA-only events, condition metadata, facts, constants, helpers
  expose json-rules-engine evaluator / rule contract

apps/web
  reads package-defined events + conditions
  lets users compose rule JSON
  sends rule JSON to API

apps/api
  owns SLA policy CRUD
  owns automation rule CRUD + validation
  does not scan SLA cases
  enqueues automation jobs but does not evaluate automation rules

apps/workers
  owns SLA scheduled scan
  builds facts
  evaluates SLA and automation rules
  dispatches case events, notifications, and socket bridge events
```

The initial SLA event catalog is deliberately narrow:

| Event | Meaning | Runtime owner |
| --- | --- | --- |
| `sla.first_response.warning` | First response deadline is close | Worker scan |
| `sla.first_response.breached` | First response deadline is overdue | Worker scan |
| `sla.resolution.warning` | Resolution deadline is close | Worker scan |
| `sla.resolution.breached` | Resolution deadline is overdue | Worker scan |
| `sla.customer_waiting.breached` | Customer has sent too many messages in the same Case without an agent response | Worker scan |

Other services may still write facts that the SLA worker reads. For example, inbound message handling can update message counters, and an LLM/sentiment service can persist sentiment results. The SLA worker does not own those upstream analyses; it only reads the current facts and emits SLA-domain conclusions.

## Goals / Non-Goals

**Goals:**

- Make the BullMQ `sla` queue the only runtime owner of SLA scanning.
- Remove the API startup call that runs SLA scan timers inside the API process.
- Run SLA scans on a 5-minute repeat interval unless a later config setting overrides it.
- Make SLA warning, breach, first-response timeout, and customer-waiting side effects worker-safe.
- Ensure worker-originated SLA notifications still create notification records and socket events through the notification queue path.
- Evaluate frontend-authored rule JSON with `json-rules-engine`, including worker-triggered automation jobs.
- Centralize shared SLA domain code in packages so API, worker, and web consume the same status/deadline semantics.
- Make package-defined events and conditions the source of truth for frontend rule authoring.
- Keep API responsibility to CRUD/validation and remove background SLA execution from API.
- Keep this change scoped to SLA-domain events; non-SLA service events remain owned by their existing modules.
- Move automation rule condition evaluation and action execution to `apps/workers`; API event subscribers only enqueue BullMQ automation jobs.

**Non-Goals:**

- Do not implement SMTP/nodemailer email delivery in this change.
- Do not redesign the entire automation UI; only wire SLA rule authoring to package-defined events/conditions where needed.
- Do not redesign the full automation action registry.
- Do not migrate unrelated broadcast worker ownership in this change.
- Do not implement LLM sentiment analysis. SLA rules may read persisted sentiment facts if another service already provides them.
- Do not move general CRM events such as `message.received`, `case.created`, CSAT, or note mentions into the SLA package.

## Decisions

### Decision: BullMQ worker owns SLA polling

`apps/api/src/index.ts` should stop importing and calling `setupSlaWorker()`. SLA polling should run only from `apps/workers/src/index.ts` through the `sla:poll` repeat job.

Rationale: SLA polling is background work and does not need the API process or Fastify Socket.IO instance. Keeping one owner removes duplicate scans and makes scaling API instances safer.

Alternative considered: keep the API scan and remove the BullMQ scan. That would be smaller but conflicts with the intended worker runtime architecture and makes multi-instance API deployments more fragile.

### Decision: Put shared SLA domain helpers and metadata in `@open333crm/shared`

SLA constants, SLA-only event names, status labels, condition metadata, fact keys, deadline calculations, priority bump rules, and pure helpers such as `getSlaState(now, dueAt, warningBeforeMinutes)` should live under `packages/shared/src/sla` and be exported from `@open333crm/shared`.

Rationale: these utilities are pure TypeScript and are needed by API, workers, and web. Putting them in `apps/api` would force workers and web to duplicate logic or import from an app boundary. `@open333crm/shared` is already ESM and exported to the workspace, and it already contains `sla-defaults`.

Alternative considered: put all SLA code into `@open333crm/automation`. That package currently owns rule-engine behavior, not general UI/API SLA display semantics. Keeping pure SLA helpers in `shared` avoids pulling automation dependencies into web.

### Decision: Frontend composes from metadata, API validates persisted JSON

The frontend should use the shared SLA event and condition catalog to build `json-rules-engine` condition trees. The API should validate that submitted active rules use known SLA event names, known condition facts/operators, and valid `json-rules-engine` structure before saving.

Rationale: this keeps the rule builder flexible while preventing the frontend and backend from drifting on allowed SLA facts. The API remains the enforcement boundary even though the frontend guides rule composition.

The catalog should expose the event's available facts instead of forcing the frontend to know service internals. For example, `sla.customer_waiting.breached` can expose `case.customerMessagesSinceLastAgentReply` even though the underlying counter is maintained by message/conversation code.

### Decision: Put rule evaluation in `@open333crm/automation` and execute from workers

The reusable `json-rules-engine` evaluator should live in `@open333crm/automation` or be moved there from the API automation module. Workers should call the package evaluator for automation jobs and SLA scans. API CRUD/test code may reuse the evaluator for explicit dry-run operations, but API event subscribers should not execute automation actions inline. Web should only produce/validate the rule JSON shape needed by the backend; it should not need the server-side evaluator in the first implementation.

Rationale: `json-rules-engine` is already a dependency of `@open333crm/automation`, and rule evaluation is automation-domain behavior. Keeping event-triggered execution in workers avoids duplicate action execution and keeps background/side-effect work out of the API process.

### Decision: Worker dispatches SLA-only events after scanning

The SLA worker should scan cases, build facts, evaluate configured SLA automation rules, and then dispatch side effects through durable paths: `CaseEvent` writes, notification queue jobs, and Redis socket bridge events.

Rationale: worker-originated events cannot use API `eventBus` because it is in-process. Treating the worker as the event distributor for SLA outcomes keeps execution in one place and makes side effects explicit.

The worker should not publish raw service events such as `message.received` or `sentiment.negative`. If a customer has sent three messages without an agent reply, the worker should emit `sla.customer_waiting.breached`. If persisted sentiment facts later reach a configured threshold, a later slice may emit `sla.sentiment_risk.detected`; the LLM analysis itself remains outside the SLA worker.

### Decision: Use worker-safe notification enqueueing for SLA events

The standalone SLA handler should not try to use API `eventBus`. When it detects one of the package-defined SLA warning or breach events, it should directly enqueue notification jobs or call a shared notification enqueue helper that writes to the `notification` queue. The existing `apps/workers` notification handler remains the single DB/socket dispatcher.

Rationale: `eventBus` is in-process only. A worker-originated SLA event must either enqueue notification jobs directly or publish a different cross-process event. The notification queue already exists and matches the required side-effect path.

Alternative considered: only publish Redis socket events from the SLA worker. That updates connected clients but skips persisted notification records and role-based notification expansion.

### Decision: Keep direct case update socket events via Redis bridge

When SLA breach bumps case priority or marks escalation metadata, the worker should publish `case.updated` through Redis `socket:emit`. This is not a notification record; it is a real-time state update for case views.

Rationale: workers cannot use `fastify.io`, and case view updates still need to reach the tenant room.

### Decision: Use `json-rules-engine` as the rule evaluation contract

Frontend-authored rule conditions should be stored in the existing `AutomationRule.conditions` JSON field using the `json-rules-engine` top-level condition format. Worker automation jobs should reuse the same evaluator semantics as the API automation service.

Rationale: The API already has a `json-rules-engine` wrapper. The missing piece is keeping the worker path from bypassing conditions. Reusing one evaluator prevents frontend rules from working in one runtime path but not another.

Alternative considered: implement SLA-specific condition loops in the SLA worker. That would be quick but creates another rules dialect and makes frontend-authored rules harder to reason about.

### Decision: Do not introduce a second SLA rule table

SLA-specific rules should use the existing `AutomationRule` model with SLA-oriented trigger types such as `sla.first_response.warning`, `sla.first_response.breached`, `sla.resolution.warning`, `sla.resolution.breached`, and `sla.customer_waiting.breached`.

Rationale: The repo already has automation rule storage, execution logs, and action structures. A second rule table would duplicate capability without a clear benefit for this slice.

## Risks / Trade-offs

- [Risk] Removing the API timer before the worker is deployed would stop SLA scanning. → Mitigation: verify the worker service registers `sla:poll` and processes a forced due case before rollout.
- [Risk] Worker-originated notification enqueueing duplicates logic from API notification subscribers. → Mitigation: extract a small shared enqueue helper or keep the recipient expansion local and covered by tests.
- [Risk] SLA poll and automation jobs may both perform side effects for the same event. → Mitigation: rely on `CaseEvent` dedupe windows and add stable job/event identifiers where needed.
- [Risk] Moving automation execution out of API means automation does not run if workers are down. → Mitigation: BullMQ keeps jobs queued until workers recover; API must still enqueue jobs.
- [Risk] Rule JSON authored by the frontend may not be valid `json-rules-engine` syntax. → Mitigation: validate conditions on create/update and provide a dry-run/test endpoint before activation.
- [Risk] Web, API, and worker could use different condition catalogs if metadata is copied locally. → Mitigation: export metadata from packages and import it from all three surfaces.
- [Risk] Moving evaluation code into a shared package may require dependency wiring for `apps/workers`. → Mitigation: keep the first implementation small and verify both API and worker builds.

## Migration Plan

1. Add shared SLA domain helpers, SLA-only event definitions, fact keys, and condition metadata under `@open333crm/shared`.
2. Add or reuse a worker-safe rule evaluator under `@open333crm/automation`.
3. Update web rule authoring to consume package-defined SLA events and conditions.
4. Update API CRUD/validation to enforce known event/condition contracts.
5. Update API, worker, and web imports to consume package-level SLA helpers instead of local copies.
6. Update API automation event subscribers to enqueue automation jobs only, without calling `triggerAutomation()` inline.
7. Update the standalone automation worker to build facts, evaluate conditions, and execute matched actions.
8. Update the standalone SLA handler to scan, build facts, evaluate rules, and enqueue notification jobs for first-response, resolution, and customer-waiting outcomes.
9. Change the BullMQ `sla:poll` repeat interval to 5 minutes.
10. Remove the API `setupSlaWorker()` startup path.
11. Run shared, automation, web, API, worker, and focused test builds.

Rollback is straightforward: restore the API `setupSlaWorker()` startup call if the worker schedule or notification path fails in deployment.
