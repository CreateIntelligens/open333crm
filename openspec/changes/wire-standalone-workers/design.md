## Context

The `apps/workers/` process exists as a standalone BullMQ consumer application intended to offload background work from the API. It currently defines four `Worker` instances (automation, broadcast, sla, notification) with empty `TODO` handler bodies — meaning no actual work is performed in this process today.

All four corresponding workloads already run **in-process inside the API**:

| Workload | API implementation | Mechanism |
|---|---|---|
| Automation | `apps/api/src/modules/automation/automation.worker.ts` | EventBus subscriber (8 events) → `triggerAutomation()` |
| Notification | `apps/api/src/modules/notification/notification.worker.ts` | EventBus subscriber (6 events) → `createAndDispatch()` |
| SLA | `apps/api/src/modules/sla/sla.worker.ts` | `setInterval(60s)` → 3 poll functions |
| Broadcast | `apps/api/src/modules/marketing/broadcast.scheduler.ts` | `setInterval(60s)` → `executeBroadcast()` |

The standalone worker process is a separate Node.js process and therefore cannot share Fastify's plugin-scoped Prisma instance, Socket.IO server, or in-memory EventBus with the API. These constraints drive the architectural decisions below.

---

## Goals / Non-Goals

**Goals**
- Wire all four BullMQ worker handlers in `apps/workers/src/index.ts` so they execute real logic.
- Establish a working Prisma initialization path in the standalone worker process.
- Convert SLA and broadcast polling from `setInterval` to repeating BullMQ jobs so they survive process restarts and are distributed-safe.
- Have the API enqueue BullMQ jobs for automation and notification workloads when the relevant EventBus events fire, giving the standalone workers a job source.
- Enable workers to emit Socket.IO events via a Redis pub/sub bridge so real-time UI updates work without a direct dependency on the API's Socket.IO server.

**Non-Goals**
- Redesigning or refactoring automation rule evaluation logic.
- Removing or disabling the existing in-process API workers during this change — they continue running as the primary path.
- Migrating other background workloads to the standalone worker.
- Introducing a new job queue schema or message format beyond what BullMQ already supports.
- Adding automated tests for the worker handlers (covered separately).

---

## Decisions

### 1. SLA and Broadcast: repeating BullMQ jobs vs. keeping `setInterval`

**Decision**: Convert to repeating BullMQ jobs (every 60 seconds).

**Rationale**: `setInterval` runs only while the process is alive and is not distributed-safe — if multiple worker replicas run, each fires its own timer causing duplicate poll cycles. BullMQ's repeating job uses Redis-backed scheduling so only one job fires per interval across all replicas. It also respects the existing queue abstraction and gives visibility into run history.

**Alternative considered**: Keep `setInterval` inside the BullMQ handler's bootstrap. Rejected because it duplicates the problem of in-process polling and doesn't benefit from BullMQ's scheduler guarantees.

### 2. Automation and Notification: API enqueues jobs vs. full migration

**Decision**: API EventBus subscribers enqueue BullMQ jobs; standalone workers consume them.

**Rationale**: The EventBus is in-process to the API and is already the trigger point for both automation and notification. Rather than re-implementing event ingestion in the worker, the API acts as the job producer and the worker as the consumer. This keeps the event routing logic in one place and requires minimal changes to existing API code.

**Alternative considered**: Move EventBus subscribers to the worker process by having the worker subscribe to Redis Streams or a separate message bus. Rejected as over-engineering for this change — the API is already the natural event source.

### 3. Socket.IO bridge: Redis pub/sub vs. direct socket client vs. DB-only

**Decision**: Workers publish to a Redis pub/sub channel (`socket:emit`); API subscribes and forwards to Socket.IO rooms.

**Rationale**: Workers cannot import or connect to the API's Socket.IO server directly without creating a tight coupling across process boundaries. A Redis pub/sub channel is already available (`@open333crm/core` exports `redis`) and is the standard pattern for cross-process socket emission. DB-only polling as an alternative has unacceptable latency for real-time events.

**Alternative considered**: Workers connect as a Socket.IO client to the API and emit via the client. Rejected because it requires the worker to know the API's URL, adds authentication complexity, and is fragile under API restarts.

### 4. Prisma initialization: standalone PrismaClient vs. shared singleton from core

**Decision**: Workers instantiate `PrismaClient` directly (standalone, no Fastify plugin).

**Rationale**: `@open333crm/core` does not export a Prisma singleton — Prisma is registered as a Fastify plugin in the API. Workers cannot use Fastify plugins. Instantiating `PrismaClient` directly in the worker bootstrap is the simplest, most portable approach. Connection pooling concerns are managed via `DATABASE_URL` (PgBouncer or similar) at the infrastructure level.

**Alternative considered**: Export a shared Prisma singleton from `@open333crm/core` or `@open333crm/database`. Not ruled out for the future, but adds scope to this change. Workers can be refactored later once a shared singleton pattern is established.

### 5. API inline workers continue alongside standalone workers

**Decision**: Yes — standalone workers are **additive** for now. API inline workers remain enabled.

**Rationale**: Removing the in-process API workers in the same change would be a risky all-or-nothing migration. Keeping both running means automation and notification jobs may execute twice (once in-process, once via the queue consumer) during the transition. This is acceptable if handlers are idempotent, which they should already be. A follow-up change will disable the API inline workers once the standalone path is validated in production.

---

## Risks / Trade-offs

| Risk | Likelihood | Mitigation |
|---|---|---|
| Double execution of automation/notification (API inline + standalone worker) | High during transition | Ensure handlers are idempotent; add job deduplication keys where critical |
| Redis pub/sub message loss on subscriber restart | Low–Medium | Events are best-effort for real-time UI; critical state is always persisted to DB first |
| Repeating BullMQ job accumulation if worker restarts frequently | Low | BullMQ deduplicates repeating jobs by `jobId`; use stable job IDs |
| Prisma connection pool exhaustion under load | Medium | Configure `connection_limit` in `DATABASE_URL`; monitor pool metrics |
| Worker process crashes silently (no supervisor in dev) | Medium | Add process-level error handlers; configure `pm2` or Docker restart policies in production |

---

## Migration Plan

1. **Bootstrap** — Add Prisma, logger, and channel plugin initialization to `apps/workers/src/index.ts` before workers start.
2. **SLA repeating job** — Register `sla:poll` repeating job; implement `sla.handler.ts` with direct Prisma, duplicating poll logic from the API module.
3. **Broadcast repeating job** — Register `broadcast:poll` repeating job; implement `broadcast.handler.ts`.
4. **Notification consumer** — Implement `notification.handler.ts`; add enqueue calls to the API's notification EventBus subscriber.
5. **Automation consumer** — Implement `automation.handler.ts`; add enqueue calls to the API's automation EventBus subscriber.
6. **Redis pub/sub bridge** — Add publisher helper to workers; add subscriber to API's socket plugin.
7. **Validation** — Build workers, run locally, smoke-test each queue, confirm no TypeScript errors.
8. **Follow-up (separate change)** — Disable API inline workers once standalone is confirmed stable.

---

## Open Questions

1. **Should API inline workers be removed once standalone is stable?** The current plan keeps both, but long-term they should be removed to eliminate double execution. A follow-up change should explicitly target this.
2. **Should `PrismaClient` be exported from a shared `@open333crm/database` package?** Centralizing this would simplify future worker additions and ensure consistent connection configuration.
3. **Should the `socket:emit` Redis channel carry authentication/authorization metadata?** Currently it's an internal channel, but if the worker emits to per-user rooms, room names implicitly carry identity. This is likely sufficient.
4. **How should repeating job failures be handled?** BullMQ will retry based on the queue's default settings. Should SLA/broadcast jobs be configured with a specific retry count or backoff strategy?
