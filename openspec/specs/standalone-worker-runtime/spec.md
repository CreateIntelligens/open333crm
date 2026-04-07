## ADDED Requirements

### Requirement: Standalone Worker Process Bootstrap
The `apps/workers/` process SHALL initialize a `PrismaClient` instance, a Redis connection (via `@open333crm/core`), a logger (via `@open333crm/core`), and the channel plugin registry (via `@open333crm/channel-plugins`) before registering any BullMQ queue consumers. If any of these initializations fail, the process SHALL log the error and exit with a non-zero status code.

#### Scenario: Successful bootstrap
- **WHEN** the worker process starts with valid `DATABASE_URL` and `REDIS_URL` environment variables
- **THEN** Prisma connects to the database, Redis connects, the channel plugin registry is populated, and all four BullMQ workers begin listening for jobs

#### Scenario: Database connection failure at startup
- **WHEN** the worker process starts and `DATABASE_URL` is invalid or the database is unreachable
- **THEN** the process logs a fatal error and exits with code 1 before registering any workers

---

### Requirement: SLA Polling as Repeating BullMQ Job
The SLA worker SHALL register a repeating BullMQ job on the `sla` queue with a stable job ID (`sla:poll`) and a repeat interval of 60,000 ms. On each execution the job SHALL invoke the three SLA poll functions: warning detection, breach detection, and first-response timeout detection. Each poll function SHALL use the standalone `PrismaClient` instance initialized at bootstrap.

#### Scenario: SLA poll executes on schedule
- **WHEN** the `sla:poll` repeating job fires
- **THEN** the worker queries the database for conversations with pending SLA warnings, SLA breaches, and overdue first-response SLAs, and updates their status accordingly

#### Scenario: Repeating job already registered (worker restart)
- **WHEN** the worker process restarts and attempts to register the `sla:poll` repeating job
- **THEN** BullMQ deduplicates the job by its stable ID and does not create a duplicate schedule

#### Scenario: SLA poll function throws an error
- **WHEN** one of the three SLA poll functions throws during a `sla:poll` job execution
- **THEN** the job fails, BullMQ records the failure, and the other poll functions still execute (errors are isolated per function)

---

### Requirement: Broadcast Polling as Repeating BullMQ Job
The broadcast worker SHALL register a repeating BullMQ job on the `broadcast` queue with a stable job ID (`broadcast:poll`) and a repeat interval of 60,000 ms. On each execution the job SHALL query for scheduled broadcast campaigns that are due to run and call `executeBroadcast()` for each, using the standalone `PrismaClient` and the channel plugin registry.

#### Scenario: Broadcast poll finds a due campaign
- **WHEN** the `broadcast:poll` job fires and there is a broadcast campaign scheduled at or before the current time with status `scheduled`
- **THEN** the worker calls the broadcast execution function, which sends messages via the appropriate channel plugin and updates the campaign status to `sent`

#### Scenario: No due broadcasts
- **WHEN** the `broadcast:poll` job fires and no campaigns are scheduled at or before the current time
- **THEN** the job completes successfully with no side effects

#### Scenario: Broadcast execution fails for one campaign
- **WHEN** the `broadcast:poll` job fires and execution fails for one campaign
- **THEN** the error is logged, that campaign's status is updated to reflect the failure, and execution continues for remaining campaigns

---

### Requirement: Automation Job Consumer
The automation worker SHALL consume jobs from the `automation` queue. Each job payload SHALL include the trigger event name and the relevant entity context (e.g., `conversationId`, `contactId`). The handler SHALL evaluate automation rules matching the trigger against the provided context using the standalone `PrismaClient`.

#### Scenario: Automation job consumed successfully
- **WHEN** a job is dequeued from the `automation` queue with a valid trigger event and context
- **THEN** the handler evaluates matching automation rules and executes their configured actions (e.g., assign agent, send message, update status)

#### Scenario: No matching automation rules
- **WHEN** a job is dequeued and no automation rules match the trigger and context
- **THEN** the job completes successfully with no side effects

#### Scenario: Automation action execution fails
- **WHEN** an automation rule matches but its action execution throws
- **THEN** the error is logged with the job ID and rule ID, and BullMQ retries the job according to the queue's retry policy

---

### Requirement: Notification Job Consumer
The `apps/workers` notification worker SHALL be the **sole** processor responsible for persisting notification records and delivering socket events for all notification types. The `apps/api` event-bus worker (`notification.worker.ts`) SHALL only enqueue BullMQ jobs onto the `notification` queue and SHALL NOT directly write to the database or emit socket events. Each job payload SHALL include the notification type, recipient identifiers, and relevant entity context. The handler SHALL create a notification record in the database via the standalone `PrismaClient` and publish a `socket:emit` message to Redis pub/sub so the API can forward the event to the appropriate Socket.IO room.

#### Scenario: Notification enqueued from API event bus
- **WHEN** a domain event (e.g., `case.assigned`, `message.received`) is received by the API event-bus worker
- **THEN** a BullMQ job is added to the `notification` queue with the full notification payload, and no direct DB write or socket emit occurs in the API process

#### Scenario: Notification job consumed by worker
- **WHEN** the `notificationWorker` in `apps/workers` dequeues a `notification:dispatch` job
- **THEN** it writes a single `notification` record to the database and emits the `notification.new` socket event via Redis pub/sub exactly once

#### Scenario: Database write succeeds but Redis publish fails
- **WHEN** the notification DB write succeeds but Redis pub/sub publish throws
- **THEN** the error is logged; the job is still considered successful (notification is persisted; real-time delivery is best-effort)

#### Scenario: Database write fails
- **WHEN** the notification DB write throws
- **THEN** the job fails and BullMQ retries according to the queue's retry policy; no Redis publish is attempted

#### Scenario: Redis unavailable at enqueue time
- **WHEN** the API event-bus worker attempts to enqueue a notification job and the Redis connection is unavailable
- **THEN** the `notificationQueue.add` call throws, the error is caught and logged, and no duplicate processing occurs

---

### Requirement: Redis Pub/Sub Socket Bridge
When a standalone worker needs to emit a WebSocket event to connected clients, it SHALL publish a JSON payload to the Redis pub/sub channel `socket:emit`. The payload SHALL conform to `{ room: string; event: string; data: unknown }`. The API process SHALL maintain a Redis subscriber on the `socket:emit` channel and, upon receiving a message, forward it to the matching Socket.IO room using `io.to(room).emit(event, data)`.

#### Scenario: Worker publishes a socket event
- **WHEN** a standalone worker publishes `{ room: "conversation:42", event: "notification:new", data: {...} }` to the `socket:emit` Redis channel
- **THEN** the API's Redis subscriber receives the message and calls `io.to("conversation:42").emit("notification:new", {...})`

#### Scenario: No clients connected to the target room
- **WHEN** the API receives a `socket:emit` message for a room with no active subscribers
- **THEN** the API calls `io.to(room).emit(...)` which is a no-op; no error is thrown

#### Scenario: API Redis subscriber is temporarily disconnected
- **WHEN** the API's Redis subscriber disconnects and reconnects
- **THEN** messages published during the disconnection window are lost (best-effort delivery); the subscriber resumes processing new messages after reconnection
