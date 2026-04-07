## Context

The API server (`apps/api`) has an event-bus worker (`notification.worker.ts`) that subscribes to domain events (e.g., `case.assigned`, `message.received`) and handles notification dispatch. Currently it does two things per event:

1. Calls `createAndDispatch(prisma, io, ...)` — synchronously writes to DB and emits via the in-process Socket.IO server
2. Calls `notificationQueue.add(...)` — enqueues a BullMQ job for the standalone worker container

The standalone worker (`apps/workers`) already has a `notificationWorker` that consumes the queue and calls `handleNotificationJob`, which writes to DB and emits via Redis pub/sub → Socket.IO bridge. This means every event triggers **two** DB inserts and **two** socket emissions.

## Goals / Non-Goals

**Goals:**
- Eliminate duplicate DB records and double socket emissions
- Make `apps/api` responsible only for enqueuing (fire-and-forget)
- Make `apps/workers` the single authoritative processor for notification dispatch

**Non-Goals:**
- Changing the notification data model or API routes
- Modifying `apps/workers` (it is already correct)
- Adding retry logic or dead-letter handling (out of scope)

## Decisions

### Decision: Keep `notificationQueue.add`, remove `createAndDispatch`

**Rationale**: The worker container is the designated processor for async jobs. It uses Redis pub/sub (`socket-bridge.ts`) to emit socket events, which works correctly in multi-container deployments where the API and worker run as separate processes. `createAndDispatch` uses `io.emit` directly, which only works within the API process and breaks in scaled deployments.

**Alternatives considered**:
- Keep `createAndDispatch` only: would break when the API is scaled horizontally and socket affinity is not guaranteed; also bypasses BullMQ retry semantics.
- Keep both with deduplication logic: adds complexity for no benefit.

### Decision: Remove `new Queue(...)` instantiation from `notification.worker.ts`

The API's event-bus worker only needs to enqueue jobs. The `Queue` instance should be initialized once and reused. Since no shared queue utility currently exists, we instantiate it locally in `notification.worker.ts` and remove the unused parts (`defaultJobOptions` with `removeOnComplete`/`removeOnFail` since those are worker-side concerns).

## Risks / Trade-offs

- **Risk**: If the Redis connection is unavailable at the time of enqueue, the notification is lost.  
  → **Mitigation**: BullMQ's `Queue.add` will throw; the existing `try/catch` in each event handler will log the error. Acceptable for now — full retry/fallback is a separate concern.

- **Risk**: Slight latency increase — notifications are now async (queue round-trip) instead of immediate.  
  → **Mitigation**: Negligible in practice; BullMQ jobs are typically picked up within milliseconds.

## Migration Plan

1. Remove `import { createAndDispatch }` from `notification.worker.ts`
2. Remove all `createAndDispatch(...)` calls (one per event handler)
3. Keep `notificationQueue.add(...)` calls intact
4. Clean up `new Queue(...)` options — remove `removeOnComplete`/`removeOnFail` (those belong on the worker side, which already sets them)
5. Deploy — no DB migration required
