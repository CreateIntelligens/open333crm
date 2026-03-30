## Automation Engine Requirements

### Requirement: Event Trigger
The system SHALL trigger automation rules when an event occurs, such as `message.received`.

#### Scenario: Trigger on inbound message
- **WHEN** an inbound message is received in any channel
- **THEN** matching automation rules are evaluated

### Requirement: Rule Conditions
The system SHALL support evaluating complex boolean conditions on message/contact attributes.

#### Scenario: Matching VIP customer
- **WHEN** a rule requires `contact.membership == "VIP"` and `message.sentiment == "negative"`
- **THEN** the rule matches only if both conditions are true

### Requirement: Actions
The system SHALL support actions such as `add_tag`, `send_message`, and `create_case`.

#### Scenario: Auto-tagging
- **WHEN** a rule with `add_tag("hot_lead")` matches
- **THEN** the `hot_lead` tag is attached to the contact

---

### Requirement: Dual-Path Automation Triggering
The automation engine SHALL support two execution paths for triggering automation rule evaluation:

1. **In-process EventBus path (existing)**: The API process subscribes to internal EventBus events and calls `triggerAutomation()` directly within the API process. This path remains active and unchanged.
2. **BullMQ queue path (new)**: When the API's EventBus automation subscriber fires, it SHALL additionally enqueue a job on the `automation` BullMQ queue with the trigger event name and entity context as the job payload. The standalone worker process consumes this job and independently evaluates automation rules using its own `PrismaClient` instance.

Both paths may execute concurrently during the transition period. Automation rule evaluation and action execution SHALL be idempotent so that duplicate executions do not produce inconsistent state.

#### Scenario: Automation triggered via EventBus (in-process path)
- **WHEN** an internal EventBus event matching an automation trigger fires in the API process
- **THEN** `triggerAutomation()` is called in-process as before, and the result is applied immediately

#### Scenario: Automation triggered via BullMQ (standalone path)
- **WHEN** the same EventBus event fires and the API enqueues a job on the `automation` queue
- **THEN** the standalone worker dequeues the job and evaluates automation rules using direct Prisma access, producing the same outcome as the in-process path

#### Scenario: Standalone worker is down when job is enqueued
- **WHEN** the `automation` queue worker process is not running
- **THEN** the job remains in the BullMQ queue until the worker restarts and processes it; the in-process path already handled the event so no automation is missed

#### Scenario: Both paths execute for the same event
- **WHEN** both the in-process EventBus handler and the standalone queue consumer execute for the same trigger event
- **THEN** automation rule actions are idempotent and duplicate execution does not corrupt state (e.g., a "send message" action checks if the message was already sent before sending again)
