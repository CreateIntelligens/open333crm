## 1. Packages: SLA Contract And Rule Engine

- [x] 1.1 Create a shared SLA module under `packages/shared/src/sla` and export it from `@open333crm/shared`
- [x] 1.2 Define package-level SLA-only event names: `sla.first_response.warning`, `sla.first_response.breached`, `sla.resolution.warning`, `sla.resolution.breached`, and `sla.customer_waiting.breached`
- [x] 1.3 Define package-level SLA condition metadata and fact keys for frontend rule authoring
- [x] 1.4 Move shared SLA constants and priority bump semantics into the shared SLA module
- [x] 1.5 Add pure SLA helpers for deadline/state calculation, including normal/warning/breached state
- [x] 1.6 Move or expose the reusable `json-rules-engine` evaluator from `@open333crm/automation`
- [x] 1.7 Add SLA-oriented fact builder support, including case, assignee, priority, SLA kind/state, due time, remaining/overdue minutes, and customer waiting counters
- [x] 1.8 Expose persisted sentiment fact keys such as `sentiment.latest` and `sentiment.negativeCount` only as optional SLA-readable facts; do not implement LLM sentiment analysis in this change

## 2. Web: Rule Authoring

- [x] 2.1 Update frontend automation/SLA rule authoring to consume package-defined SLA events
- [x] 2.2 Update frontend condition builder options to consume package-defined SLA condition metadata
- [x] 2.3 Ensure frontend emits `json-rules-engine` compatible condition JSON for SLA rules
- [x] 2.4 Update web SLA countdown/badge code to consume shared SLA helpers where applicable

## 3. API: CRUD And Validation

- [x] 3.1 Keep API responsible for SLA policy CRUD and automation rule CRUD only; do not run SLA scan timers from API startup
- [x] 3.2 Validate automation rule create/update/test payloads against package-defined SLA events and condition metadata
- [x] 3.3 Update API automation code to use the package-level evaluator rather than an app-local evaluator
- [x] 3.4 Update API case/SLA code to consume shared SLA helpers where applicable
- [x] 3.5 Remove the API startup import and call for `setupSlaWorker()` from `apps/api/src/index.ts`
- [x] 3.6 Remove or quarantine the old API in-process SLA timer module so it cannot be accidentally started

## 4. Workers: SLA Scan And Event Distribution

- [x] 4.1 Change `apps/workers/src/index.ts` so `sla:poll` repeats every 300,000 ms with stable job id `sla:poll`
- [x] 4.2 Keep `apps/workers/src/handlers/sla.handler.ts` as the authoritative SLA scan implementation for first-response warning/breach, resolution warning/breach, and customer-waiting breach
- [x] 4.3 Update worker SLA scan code to consume shared SLA helpers and package-defined event names
- [x] 4.4 Build package-defined SLA facts for each scan outcome without emitting raw upstream service events such as `message.received`
- [x] 4.5 Evaluate matching SLA automation rules with `json-rules-engine` before executing rule actions
- [x] 4.6 Add a worker-safe notification enqueue helper or direct notification queue producer for SLA worker outcomes
- [x] 4.7 On first-response warning, create a CaseEvent and enqueue a notification for the assigned agent
- [x] 4.8 On first-response breach, create `first_response_breached` CaseEvent and enqueue breach notifications through the notification queue
- [x] 4.9 On resolution warning, create a CaseEvent and enqueue a notification for the assigned agent
- [x] 4.10 On resolution breach, create `sla_breached` CaseEvent, apply priority/escalation update, enqueue notifications for the assignee and active supervisors/admins
- [x] 4.11 On customer-waiting breach, create `customer_waiting_breached` CaseEvent and enqueue notifications through the notification queue
- [x] 4.12 Publish `case.updated` through the Redis socket bridge when the worker changes case priority or escalation state
- [x] 4.13 Remove API in-process automation rule execution from EventBus subscribers so they enqueue BullMQ jobs only
- [x] 4.14 Build automation facts inside `apps/workers` before evaluating queued automation jobs

## 5. Tests

- [x] 5.1 Add focused tests for shared SLA event/condition metadata and state/deadline helpers
- [x] 5.2 Add focused tests for frontend-compatible SLA condition JSON validation
- [x] 5.3 Add focused tests for `json-rules-engine` condition evaluation in the worker automation path
- [x] 5.4 Add focused tests for SLA warning notification enqueue behavior
- [x] 5.5 Add focused tests for SLA breach priority update and supervisor/admin notification enqueue behavior
- [x] 5.6 Add a regression check that API startup no longer registers the in-process SLA scanner
- [x] 5.7 Add focused tests for customer-waiting breach fact building and rule evaluation

## 6. Verification

- [x] 6.1 Run `pnpm --filter @open333crm/shared build`
- [x] 6.2 Run `pnpm --filter @open333crm/automation build`
- [x] 6.3 Run `pnpm --filter @open333crm/web build`
- [x] 6.4 Run `pnpm --filter @open333crm/api build`
- [x] 6.5 Run `pnpm --filter @open333crm/workers build`
- [x] 6.6 Run any focused tests added for SLA and automation rule evaluation
- [x] 6.7 Run `openspec status --change move-sla-to-bullmq-rules-engine --json` and confirm all tasks are tracked
