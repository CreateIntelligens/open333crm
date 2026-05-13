## MODIFIED Requirements

### Requirement: Rule Conditions
The system SHALL support evaluating complex boolean conditions on message, contact, case, SLA, and event facts using `json-rules-engine`. The system SHALL persist automation rule conditions using the `conditions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `conditionsJson` in database operations. Conditions accepted from the frontend SHALL use the `json-rules-engine` top-level condition format and SHALL be validated before an active rule is saved or tested.

#### Scenario: Matching VIP customer
- **WHEN** a rule requires `contact.membership == "VIP"` and `message.sentiment == "negative"`
- **THEN** the rule matches only if both conditions are true

#### Scenario: Creating a rule with conditions
- **WHEN** a new automation rule is created via the API
- **THEN** the conditions are written to the `conditions` Prisma field only

#### Scenario: Updating a rule's conditions
- **WHEN** an automation rule is updated with new conditions
- **THEN** the conditions are written to the `conditions` Prisma field only

#### Scenario: Frontend rule JSON is valid
- **WHEN** the frontend submits a valid `json-rules-engine` condition tree for an automation rule
- **THEN** the API stores the condition tree unchanged in `AutomationRule.conditions`

#### Scenario: Frontend rule JSON is invalid
- **WHEN** the frontend submits a malformed condition tree for an active automation rule
- **THEN** the API rejects the request with a validation error and does not activate the rule

### Requirement: Worker-Owned Automation Triggering
The automation engine SHALL use the BullMQ worker path for event-triggered automation rule evaluation. When the API's EventBus automation subscriber fires, it SHALL enqueue a job on the `automation` BullMQ queue with the trigger event name and entity context as the job payload. The API process SHALL NOT call `triggerAutomation()` inline from event subscribers. The standalone worker process consumes this job, builds automation facts using its own `PrismaClient` instance, evaluates rule conditions with `json-rules-engine`, and executes actions only for matched rules.

#### Scenario: Automation event enqueued by API
- **WHEN** an internal EventBus event matching an automation trigger fires in the API process
- **THEN** the API enqueues an `automation:evaluate` job and does not execute automation actions inline

#### Scenario: Automation triggered via BullMQ worker
- **WHEN** the standalone worker dequeues an automation job
- **THEN** it builds facts, evaluates matching rules with `json-rules-engine`, and applies actions only for matched rules

#### Scenario: Standalone worker is down when job is enqueued
- **WHEN** the `automation` queue worker process is not running
- **THEN** the job remains in the BullMQ queue until the worker restarts and processes it

#### Scenario: Worker rule conditions do not match
- **WHEN** the standalone worker receives an automation job for a rule whose conditions do not match the built facts
- **THEN** the worker does not execute that rule's actions

## ADDED Requirements

### Requirement: Package-Defined Rule Contract
The system SHALL define SLA-only automation event names, condition facts, allowed operators, fact metadata, and rule authoring labels in packages that can be consumed by web, API, and worker code. The frontend SHALL compose rule JSON from this package-defined contract, the API SHALL validate rule CRUD payloads against it, and workers SHALL evaluate and dispatch events using the same contract. General CRM events such as inbound messages, CSAT, note mentions, and sentiment-analysis completion SHALL remain outside the SLA event catalog for this change.

#### Scenario: Frontend composes SLA rule
- **WHEN** the frontend renders SLA rule authoring controls
- **THEN** it uses package-defined event and condition metadata instead of hard-coded local lists

#### Scenario: API validates SLA rule payload
- **WHEN** the API receives an automation rule CRUD request for an SLA event
- **THEN** it validates the event name, condition facts, operators, and `json-rules-engine` structure against the package-defined contract before persisting the rule

#### Scenario: Worker evaluates SLA rule payload
- **WHEN** the worker evaluates SLA automation rules during an SLA scan
- **THEN** it builds facts using the package-defined fact contract and evaluates conditions with `json-rules-engine`

#### Scenario: Non-SLA event is not part of SLA contract
- **WHEN** the frontend renders SLA rule authoring controls
- **THEN** it does not present raw events such as `message.received` or `sentiment.negative` as SLA events

### Requirement: SLA Event Catalog
The system SHALL provide an initial SLA event catalog with these worker-originated events: `sla.first_response.warning`, `sla.first_response.breached`, `sla.resolution.warning`, `sla.resolution.breached`, and `sla.customer_waiting.breached`. Each event SHALL define a label, description, allowed fact keys, and supported operators for frontend rule authoring and API validation.

#### Scenario: First response warning event
- **WHEN** the SLA worker detects that an active Case is close to its first-response deadline
- **THEN** it evaluates rules for `sla.first_response.warning`

#### Scenario: First response breach event
- **WHEN** the SLA worker detects that an active Case has no first response after its first-response deadline
- **THEN** it evaluates rules for `sla.first_response.breached`

#### Scenario: Resolution warning event
- **WHEN** the SLA worker detects that an active Case is close to its resolution deadline
- **THEN** it evaluates rules for `sla.resolution.warning`

#### Scenario: Resolution breach event
- **WHEN** the SLA worker detects that an active Case is past its resolution deadline
- **THEN** it evaluates rules for `sla.resolution.breached`

#### Scenario: Customer waiting breach event
- **WHEN** the SLA worker detects that the same Case has reached the configured customer-message-without-agent-reply threshold
- **THEN** it evaluates rules for `sla.customer_waiting.breached`

### Requirement: SLA Automation Facts
The automation engine SHALL expose SLA-related facts for worker-triggered automation evaluation. SLA facts SHALL include case id, tenant id, assignee id, priority, SLA due time, SLA kind, warning/breach state, elapsed/remaining time, customer-message waiting counters, and persisted sentiment facts where available. The SLA worker SHALL NOT perform LLM sentiment analysis; it SHALL only read sentiment facts produced by another service.

#### Scenario: SLA warning facts are evaluated
- **WHEN** an SLA warning event is evaluated by the automation engine
- **THEN** rules can match on facts such as `sla.state`, `sla.kind`, `sla.dueAt`, `sla.remainingMinutes`, `case.priority`, and `case.assigneeId`

#### Scenario: SLA breach facts are evaluated
- **WHEN** an SLA breach event is evaluated by the automation engine
- **THEN** rules can match on facts such as `sla.state`, `sla.kind`, `sla.overdueMinutes`, `case.priority`, and `case.assigneeId`

#### Scenario: Customer waiting facts are evaluated
- **WHEN** a customer waiting breach event is evaluated by the automation engine
- **THEN** rules can match on facts such as `case.customerMessagesSinceLastAgentReply`, `case.lastAgentReplyAt`, `case.lastCustomerMessageAt`, `case.priority`, and `case.assigneeId`

#### Scenario: Persisted sentiment facts are available
- **WHEN** another service has persisted sentiment facts for a Case
- **THEN** SLA rules can match on facts such as `sentiment.latest` and `sentiment.negativeCount` without the SLA worker performing sentiment analysis

#### Scenario: SLA rule action runs after match
- **WHEN** an SLA automation rule matches the built facts
- **THEN** the engine executes the configured actions in priority order using the same action semantics as other automation triggers

### Requirement: Shared SLA Domain Semantics
SLA status names, SLA-only event names, condition metadata, priority bump semantics, fact keys, and pure deadline/status calculations SHALL be provided by a shared package consumed by API, worker, and web code. Application code SHALL NOT maintain separate local copies of these rules.

#### Scenario: Web displays SLA countdown
- **WHEN** the web app renders an SLA countdown or badge
- **THEN** it uses shared SLA status/deadline helpers so its warning and breach states match backend evaluation

#### Scenario: API creates SLA-backed case
- **WHEN** the API creates a Case with an SLA policy
- **THEN** it uses shared SLA priority/deadline semantics where applicable instead of duplicating local constants

#### Scenario: Worker evaluates SLA state
- **WHEN** the SLA worker scans active Cases
- **THEN** it uses shared SLA status and priority helpers so worker behavior matches API and web expectations

#### Scenario: Package metadata changes
- **WHEN** a new SLA event or condition fact is added to the package-defined contract
- **THEN** frontend authoring, API validation, and worker evaluation can consume the new definition without maintaining three independent lists
