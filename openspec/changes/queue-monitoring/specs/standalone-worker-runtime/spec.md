# Spec Delta

## MODIFIED Requirements

### Requirement: Notification Job Consumer
The `apps/workers` notification worker SHALL be the **sole** processor responsible for persisting notification records and delivering socket events for all notification types. The `apps/api` event-bus worker (`notification.worker.ts`) SHALL only enqueue BullMQ jobs onto the `notification` queue and SHALL NOT directly write to the database or emit socket events.

#### Scenario: Notification enqueued from API event bus
- **WHEN** a domain event (e.g., `case.assigned`, `message.received`) is received by the API event-bus worker
- **THEN** a BullMQ job is added to the `notification` queue with the full notification payload, and no direct DB write or socket emit occurs in the API process

#### Scenario: Redis unavailable at enqueue time
- **WHEN** the API notification subscriber attempts to enqueue a notification job and the Redis connection is unavailable
- **THEN** the `notificationQueue.add` call throws, the subscriber job for the event fails, and BullMQ retries that subscriber job; the error is not caught only to be logged

### Requirement: Notification Job Handling
Each `notification` job payload SHALL include the notification type, recipient identifiers, and relevant entity context. The notification job handler SHALL create a notification record in the database via the standalone `PrismaClient` and publish a `socket:emit` message to Redis pub/sub so the API can forward the event to the appropriate Socket.IO room.

Every producer of the `notification` queue SHALL add jobs with 3 attempts and exponential backoff starting at 5 seconds. Notification delivery is at least once: when the worker process stops after the record is written and before BullMQ marks the job completed, BullMQ runs the job again and the agent receives a second identical notification. The system accepts this duplicate.

#### Scenario: Notification job consumed by worker
- **WHEN** the `notificationWorker` in `apps/workers` dequeues a `notification:dispatch` job and both the DB write and the Redis publish succeed
- **THEN** it writes one `notification` record to the database, emits the `notification.new` socket event via Redis pub/sub, and the job completes

#### Scenario: Database write succeeds but Redis publish fails
- **WHEN** the notification DB write succeeds but Redis pub/sub publish throws
- **THEN** the error is logged; the job is still considered successful (notification is persisted; real-time delivery is best-effort)

#### Scenario: Database write fails
- **WHEN** the notification DB write throws
- **THEN** the job fails and BullMQ retries according to the queue's retry policy; no Redis publish is attempted

#### Scenario: Database write keeps failing
- **WHEN** the notification DB write throws on all 3 attempts of a `notification:dispatch` job
- **THEN** the job moves to the failed set after the third attempt

#### Scenario: Both producers set the retry policy
- **WHEN** the API notification subscriber or a worker handler (for example the SLA poll) adds a `notification:dispatch` job
- **THEN** the job has 3 attempts and exponential backoff starting at 5 seconds

#### Scenario: Worker stops after the record is written
- **WHEN** the worker process stops after writing the notification record and before the job is marked completed
- **THEN** BullMQ runs the job again and the agent has two identical notifications
