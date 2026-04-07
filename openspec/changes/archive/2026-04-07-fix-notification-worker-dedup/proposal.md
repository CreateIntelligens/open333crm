## Why

`apps/api/src/modules/notification/notification.worker.ts` calls both `createAndDispatch` (direct DB write + Socket.IO emit) **and** `notificationQueue.add` on every event. Since `apps/workers` already has a proper BullMQ consumer (`notification.handler.ts`) that writes to DB and pushes via Redis pub/sub, every notification is processed twice — resulting in duplicate DB records and double socket emissions.

## What Changes

- Remove all `createAndDispatch` calls from `notification.worker.ts` in the API
- Remove the `new Queue(...)` instantiation from `notification.worker.ts` (retain only `notificationQueue.add` via a shared queue instance)
- The `apps/workers` notification handler becomes the sole processor responsible for DB persistence and socket delivery

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `standalone-worker-runtime`: The notification dispatch flow now exclusively goes through the BullMQ worker; the API event bus only enqueues jobs.

## Impact

- `apps/api/src/modules/notification/notification.worker.ts` — remove `createAndDispatch` import and all direct-dispatch calls
- `apps/workers/src/handlers/notification.handler.ts` — no change required (already correct)
- No API route changes, no schema changes
- Duplicate notifications and DB records are eliminated
