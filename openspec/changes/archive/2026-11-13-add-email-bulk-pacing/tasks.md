# Tasks

## 1. Configuration and Throttling Classification

- [x] 1.1 Add failing tests in `apps/api/tests/unit/modules/email/email-delivery.test.ts` and `apps/api/tests/unit/modules/email/email-failover.test.ts` for configurable rate/concurrency/batch parameters, `EMAIL_SMTP_BULK_RATE_PER_SEC <= EMAIL_SMTP_RATE_PER_SEC` validation, and `454 Maximum sending rate exceeded` backing off without opening the Resend circuit.
- [x] 1.2 Add configurable parameters in `apps/api/src/config/env.ts` and update `apps/api/src/modules/email/email.service.ts` to differentiate `454` rate throttling from service/daily-quota rejections and perform bounded transactional rate pacing.

## 2. Redis Sliding-Window Rate Limiter and Priority Reservation

- [x] 2.1 Add failing tests in `apps/api/tests/unit/modules/email/email-failover.test.ts` and `apps/api/tests/feature/modules/email/email-failover.test.ts` for 1-second sliding-window rate limits, bulk headroom reservation for transactional emails, Resend rate limits, and `throttled` lease release.
- [x] 2.2 Implement configurable limits and Redis Cluster-safe sliding-window rate limiting with priority reservation in `apps/api/src/modules/email/email-failover.ts`.

## 3. Queued Auto-Batching and Monitoring

- [x] 3.1 Add failing tests in `apps/api/tests/unit/modules/email/email-queue.test.ts` for `enqueueEmailBatch` chunking/staggered delays, `DelayedError` rescheduling on `EmailCapacityError`, and `Canvas` email routing through `enqueueEmail`.
- [x] 3.2 Export `EMAIL_DISPATCH_QUEUE` from `packages/core/src/outbox/queues.ts`, create `apps/api/src/modules/email/email-queue.ts`, wire worker/close hooks and `setupCanvasWorker` in `apps/api/src/index.ts` and `apps/api/src/modules/canvas/canvas.worker.ts`, and register `EMAIL_DISPATCH_QUEUE` in `apps/api/src/modules/queue-monitoring/monitored-queues.ts`.

## 4. Verification and Delivery

- [x] 4.1 Update `.env.api.example`, `docs/10_TECH_STACK.md`, `docs/ref/features/tenant/NOTIFICATIONS.md`, `docs/ref/features/feature-map.json`, and `CHANGELOG.md`.
- [x] 4.2 Run unit tests, isolated Redis feature tests, `tsc`, `monitored-queues.test.ts`, tenant/architecture checks, and OpenSpec validation.
- [x] 4.3 Archive `add-email-bulk-pacing` with the OpenSpec CLI and rebuild/deploy to UAT.
