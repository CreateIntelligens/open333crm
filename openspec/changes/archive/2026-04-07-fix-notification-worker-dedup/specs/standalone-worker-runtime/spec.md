## MODIFIED Requirements

### Requirement: Notification Job Consumer
The `apps/workers` notification worker SHALL be the **sole** processor responsible for persisting notification records and delivering socket events for all notification types. The `apps/api` event-bus worker (`notification.worker.ts`) SHALL only enqueue BullMQ jobs onto the `notification` queue and SHALL NOT directly write to the database or emit socket events.

#### Scenario: Notification enqueued from API event bus
- **WHEN** a domain event (e.g., `case.assigned`, `message.received`) is received by the API event-bus worker
- **THEN** a BullMQ job is added to the `notification` queue with the full notification payload, and no direct DB write or socket emit occurs in the API process

#### Scenario: Notification job consumed by worker
- **WHEN** the `notificationWorker` in `apps/workers` dequeues a `notification:dispatch` job
- **THEN** it writes a single `notification` record to the database and emits the `notification.new` socket event via Redis pub/sub exactly once

#### Scenario: Redis unavailable at enqueue time
- **WHEN** the API event-bus worker attempts to enqueue a notification job and the Redis connection is unavailable
- **THEN** the `notificationQueue.add` call throws, the error is caught and logged, and no duplicate processing occurs
