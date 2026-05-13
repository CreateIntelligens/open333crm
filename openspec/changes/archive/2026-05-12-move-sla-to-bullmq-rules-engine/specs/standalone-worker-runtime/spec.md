## MODIFIED Requirements

### Requirement: SLA Polling as Repeating BullMQ Job
The SLA worker SHALL register a repeating BullMQ job on the `sla` queue with a stable job ID (`sla:poll`) and a repeat interval of 300,000 ms. The API process SHALL NOT start any in-process SLA polling timer. On each execution the BullMQ job SHALL invoke SLA poll functions for first-response warning/breach, resolution warning/breach, and customer-waiting breach detection. Each poll function SHALL use the standalone `PrismaClient` instance initialized at worker bootstrap.

#### Scenario: SLA poll executes on schedule
- **WHEN** the `sla:poll` repeating job fires
- **THEN** the worker queries the database for active Cases with pending first-response warnings/breaches, resolution warnings/breaches, and customer-waiting breaches, and applies the required case events, case updates, and asynchronous notification side effects

#### Scenario: Repeating job already registered (worker restart)
- **WHEN** the worker process restarts and attempts to register the `sla:poll` repeating job
- **THEN** BullMQ deduplicates the job by its stable ID and does not create a duplicate schedule

#### Scenario: SLA poll function throws an error
- **WHEN** one of the three SLA poll functions throws during a `sla:poll` job execution
- **THEN** the error is logged and isolated so the remaining poll functions still execute during the same job

#### Scenario: API process starts
- **WHEN** the API process starts
- **THEN** it does not import or call the in-process SLA scanning worker and does not register SLA scan timers

## ADDED Requirements

### Requirement: Worker-Originated SLA Notification Dispatch
SLA warning, breach, and customer-waiting outcomes detected by the standalone worker SHALL dispatch notifications through the BullMQ `notification` queue. The SLA worker SHALL NOT rely on API `eventBus` for worker-originated SLA side effects.

#### Scenario: SLA warning notifies assigned agent
- **WHEN** the SLA worker detects a warning window for an assigned active Case
- **THEN** it creates a `sla_warning` CaseEvent and enqueues a `notification:dispatch` job for the assigned agent

#### Scenario: SLA breach notifies assignee and supervisors
- **WHEN** the SLA worker detects a breached active Case
- **THEN** it creates a `sla_breached` CaseEvent, applies the configured priority/escalation update, enqueues notifications for the assigned agent when present, and enqueues notifications for all active `SUPERVISOR` and `ADMIN` agents in the tenant

#### Scenario: First response breach notifies responsible users
- **WHEN** the SLA worker detects an overdue first-response SLA
- **THEN** it creates a `first_response_breached` CaseEvent and enqueues breach notifications through the notification queue

#### Scenario: Customer waiting breach notifies responsible users
- **WHEN** the SLA worker detects that a customer has sent the configured number of messages in the same Case without an agent reply
- **THEN** it creates a `customer_waiting_breached` CaseEvent and enqueues notifications through the notification queue

#### Scenario: Case state changes are emitted from worker
- **WHEN** the SLA worker changes Case priority or escalation state
- **THEN** it publishes a `case.updated` socket payload via the Redis `socket:emit` bridge to the tenant room

### Requirement: Worker SLA Event Distribution
The standalone SLA worker SHALL be responsible for converting scan outcomes into package-defined SLA-only events. For each detected first-response warning/breach, resolution warning/breach, or customer-waiting breach, the worker SHALL build facts, evaluate matching automation rules, persist required CaseEvents, and dispatch side effects through worker-safe queues or Redis socket bridge messages. The worker SHALL NOT emit raw upstream service events such as `message.received` or perform LLM sentiment analysis.

#### Scenario: Worker dispatches warning event
- **WHEN** the SLA scan detects a Case in warning state
- **THEN** the worker dispatches the package-defined warning event with facts that can be evaluated by automation rules

#### Scenario: Worker dispatches breach event
- **WHEN** the SLA scan detects a Case in breached state
- **THEN** the worker dispatches the package-defined breach event with facts that can be evaluated by automation rules and notification dispatch

#### Scenario: Worker dispatches customer waiting event
- **WHEN** the SLA scan detects a customer-waiting breach
- **THEN** the worker dispatches `sla.customer_waiting.breached` with facts that can be evaluated by automation rules and notification dispatch

#### Scenario: API does not distribute worker SLA event
- **WHEN** the worker dispatches an SLA scan outcome
- **THEN** it does not depend on API `eventBus` subscribers to distribute the event
