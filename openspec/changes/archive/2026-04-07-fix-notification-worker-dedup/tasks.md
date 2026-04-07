## 1. Clean Up API Event-Bus Worker

- [x] 1.1 Remove `import { createAndDispatch }` from `apps/api/src/modules/notification/notification.worker.ts`
- [x] 1.2 Remove `createAndDispatch(...)` call from `case.assigned` handler
- [x] 1.3 Remove `createAndDispatch(...)` call from `case.escalated` handler (loop)
- [x] 1.4 Remove `createAndDispatch(...)` call from `sla.warning` handler
- [x] 1.5 Remove `createAndDispatch(...)` call from `sla.breached` handler (loop)
- [x] 1.6 Remove `createAndDispatch(...)` call from `message.received` handler
- [x] 1.7 Remove `createAndDispatch(...)` call from `conversation.assigned` handler
- [x] 1.8 Remove unused `Server` (Socket.IO) import from `notification.worker.ts` if no longer referenced
- [x] 1.9 Remove `removeOnComplete`/`removeOnFail` from `new Queue(...)` options in `notification.worker.ts` (worker-side concern)
- [x] 1.10 Update `setupNotificationWorker` signature to remove `io: Server` parameter if no longer needed

## 2. Verify Worker Container

- [x] 2.1 Confirm `apps/workers/src/handlers/notification.handler.ts` writes DB record and publishes socket via Redis pub/sub (no changes needed — verify only)
- [x] 2.2 Run TypeScript check: `pnpm --filter @open333crm/api tsc --noEmit`

## 3. Manual Testing

- [ ] 3.1 Trigger a `case.assigned` event and confirm exactly one DB record is created and one socket event is received
