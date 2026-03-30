## 1. Standalone Worker Bootstrap

- [x] 1.1 Add `@open333crm/database` (or direct `@prisma/client`) to `apps/workers/package.json` dependencies if not already present, and run `pnpm install`
- [x] 1.2 Add a `prisma` singleton initialization block in `apps/workers/src/index.ts` that constructs `new PrismaClient()` before any workers are registered
- [x] 1.3 Add a top-level `process.on('uncaughtException')` and `process.on('unhandledRejection')` handler that logs the error and exits with code 1
- [x] 1.4 Import `logger` from `@open333crm/core` in the workers entry point and use it for all startup log messages
- [x] 1.5 Import and call the channel plugin registry initializer from `@open333crm/channel-plugins` during bootstrap so plugins are available to broadcast and automation handlers

## 2. SLA Worker — Repeating Job

- [x] 2.1 In `apps/workers/src/index.ts`, after bootstrap, call `slaQueue.add('sla:poll', {}, { repeat: { every: 60000 }, jobId: 'sla:poll' })` to register the repeating job
- [x] 2.2 Create `apps/workers/src/handlers/sla.handler.ts` that exports a `handleSlaPoll(prisma: PrismaClient): Promise<void>` function
- [x] 2.3 Duplicate the SLA warning detection logic from `apps/api/src/modules/sla/sla.worker.ts` into `sla.handler.ts`, replacing the Fastify-scoped Prisma reference with the passed-in `prisma` argument
- [x] 2.4 Duplicate the SLA breach detection logic from the same API module into `sla.handler.ts`
- [x] 2.5 Duplicate the first-response timeout detection logic into `sla.handler.ts`
- [x] 2.6 Wire the `sla` BullMQ `Worker` handler in `apps/workers/src/index.ts` to call `handleSlaPoll(prisma)` and wrap in a try/catch that logs failures without rethrowing (so the job completes rather than retries on non-transient errors)

## 3. Broadcast Worker — Repeating Job

- [x] 3.1 In `apps/workers/src/index.ts`, register `broadcastQueue.add('broadcast:poll', {}, { repeat: { every: 60000 }, jobId: 'broadcast:poll' })` during bootstrap
- [x] 3.2 Create `apps/workers/src/handlers/broadcast.handler.ts` that exports `handleBroadcastPoll(prisma: PrismaClient, plugins: ChannelPluginRegistry): Promise<void>`
- [x] 3.3 Duplicate the broadcast scheduling query from `apps/api/src/modules/marketing/broadcast.scheduler.ts` into `broadcast.handler.ts`, using the passed-in `prisma`
- [x] 3.4 Duplicate the `executeBroadcast()` call logic into `broadcast.handler.ts`, using the passed-in channel plugin registry instead of Fastify-scoped plugins
- [x] 3.5 Wire the `broadcast` BullMQ `Worker` handler in `apps/workers/src/index.ts` to call `handleBroadcastPoll(prisma, plugins)`

## 4. Notification Worker — Job Consumer

- [x] 4.1 Create `apps/workers/src/handlers/notification.handler.ts` that exports `handleNotificationJob(job: Job, prisma: PrismaClient, redisPublisher: Redis): Promise<void>`
- [x] 4.2 Implement DB-write logic in `notification.handler.ts`: insert a notification record using `prisma.notification.create(...)` from the job payload
- [x] 4.3 After a successful DB write, publish `JSON.stringify({ room, event: 'notification:new', data })` to the `socket:emit` Redis pub/sub channel from `notification.handler.ts`
- [x] 4.4 Wire the `notification` BullMQ `Worker` handler in `apps/workers/src/index.ts` to call `handleNotificationJob(job, prisma, redisPublisher)`
- [x] 4.5 In the API's `apps/api/src/modules/notification/notification.worker.ts`, add an enqueue call to the `notification` BullMQ queue for each EventBus event handler, passing the notification type and context as job data

## 5. Automation Worker — Job Consumer

- [x] 5.1 Create `apps/workers/src/handlers/automation.handler.ts` that exports `handleAutomationJob(job: Job, prisma: PrismaClient): Promise<void>`
- [x] 5.2 Implement automation rule lookup in `automation.handler.ts`: query rules matching `job.data.trigger` using `prisma.automationRule.findMany(...)`
- [x] 5.3 Implement action execution loop in `automation.handler.ts`: for each matching rule, execute the configured actions (assign, send message, update status) with idempotency guards
- [x] 5.4 Wire the `automation` BullMQ `Worker` handler in `apps/workers/src/index.ts` to call `handleAutomationJob(job, prisma)`
- [x] 5.5 In the API's `apps/api/src/modules/automation/automation.worker.ts`, add an enqueue call to the `automation` BullMQ queue for each of the 8 EventBus event handlers, passing trigger name and entity IDs as job data

## 6. Redis Pub/Sub Socket Bridge

- [x] 6.1 Create `apps/workers/src/lib/socket-bridge.ts` that exports a `publishSocketEvent(redis: Redis, room: string, event: string, data: unknown): Promise<void>` helper which calls `redis.publish('socket:emit', JSON.stringify({ room, event, data }))`
- [x] 6.2 In `apps/workers/src/index.ts`, create a dedicated `redisPublisher` Redis client (separate from the BullMQ connection) and pass it to notification and automation handlers
- [x] 6.3 In the API's socket plugin (or equivalent startup module), create a Redis subscriber client and subscribe it to the `socket:emit` channel
- [x] 6.4 In the API's `socket:emit` subscriber callback, parse the JSON payload, validate that `room` and `event` are present strings, and call `io.to(room).emit(event, data)`
- [x] 6.5 Add a warning log in the API subscriber for malformed or missing-field messages, and discard them without throwing

## 7. Verify and Clean Up

- [x] 7.1 Run `pnpm --filter @open333crm/workers build` (or equivalent TypeScript compile) and resolve all type errors in the new handler files
- [ ] 7.2 Start the worker process locally with `pnpm --filter @open333crm/workers dev` and confirm via logs that `sla:poll` and `broadcast:poll` repeating jobs are registered in Redis (use `redis-cli` to inspect BullMQ keys)
- [ ] 7.3 Smoke-test the SLA worker: manually insert a conversation with an overdue SLA in the database and confirm the worker detects and updates it within 60 seconds
- [ ] 7.4 Smoke-test the broadcast worker: create a scheduled broadcast campaign due in the past and confirm the worker executes it within 60 seconds
- [ ] 7.5 Smoke-test the notification worker: trigger an action in the API that enqueues a notification job and confirm the standalone worker processes it and the UI receives the socket event
- [ ] 7.6 Update `CHANGELOG.md` with an entry noting that the standalone worker process now executes SLA polling, broadcast scheduling, automation rule evaluation, and notification dispatch
