## Purpose

Define automation rule triggers, conditions evaluation, action execution, and SLA contracts for open333CRM.

## Requirements

### Requirement: Event Trigger
The system SHALL trigger automation rules when an event occurs, such as `message.received`.

#### Scenario: Trigger on inbound message
- **WHEN** an inbound message is received in any channel
- **THEN** matching automation rules are evaluated

### Requirement: Rule Conditions
The system SHALL support evaluating complex boolean conditions on message, contact, conversation, case, SLA, and event facts using `json-rules-engine`. The system SHALL persist automation rule conditions using the `conditions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `conditionsJson` in database operations. Conditions accepted from the frontend SHALL use the `json-rules-engine` top-level condition format and SHALL be validated against the composed automation contract for the selected event before an active rule is saved or tested.

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

#### Scenario: Event-incompatible fact is rejected
- **WHEN** the frontend or API submits a condition fact that is not allowed by the composed contract for the selected event
- **THEN** the API rejects the rule with a validation error and does not persist the invalid condition

### Requirement: Actions
The system SHALL support automation actions such as `add_tag`, `send_message`, `create_case`, `update_case_status`, and `notify_supervisor`. The system SHALL persist automation rule actions using the `actions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `actionsJson` in database operations. Actions accepted from the frontend SHALL be validated against the composed automation contract for the selected event before an active rule is saved or tested.

#### Scenario: Auto-tagging
- **WHEN** a rule with `add_tag("hot_lead")` matches
- **THEN** the `hot_lead` tag is attached to the contact

#### Scenario: Creating a rule with actions
- **WHEN** a new automation rule is created via the API
- **THEN** the actions are written to the `actions` Prisma field only

#### Scenario: Updating a rule's actions
- **WHEN** an automation rule is updated with new actions
- **THEN** the actions are written to the `actions` Prisma field only

#### Scenario: Event-incompatible action is rejected
- **WHEN** the frontend or API submits an action whose required context is not available for the selected event
- **THEN** the API rejects the rule with a validation error and does not persist the invalid action

---

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

### Requirement: Package-Defined Rule Contract
The system SHALL define automation event names, condition facts, allowed operators, fact metadata, action metadata, and rule authoring labels in package-level contracts that can be consumed by web, API, and worker code. The frontend SHALL compose rule JSON from this package-defined contract, the API SHALL validate rule CRUD payloads against it, and workers SHALL build facts and dispatch actions using the same fact and action identifiers. SLA events SHALL be part of the same automation contract surface rather than a separate frontend-only or API-only list.

#### Scenario: Frontend composes event-specific rule
- **WHEN** the frontend renders automation rule authoring controls for a selected event
- **THEN** it uses package-defined event, condition, operator, and action metadata instead of hard-coded local lists

#### Scenario: API validates event-specific rule payload
- **WHEN** the API receives an automation rule CRUD request
- **THEN** it validates the event name, condition facts, operators, action types, action params, and `json-rules-engine` structure against the composed contract before persisting the rule

#### Scenario: Worker evaluates contract facts
- **WHEN** the worker evaluates automation rules
- **THEN** it builds facts using fact keys defined by the package-level contract and evaluates conditions with `json-rules-engine`

#### Scenario: Message event does not expose case-only fields
- **WHEN** the frontend renders condition fields for a message event that does not explicitly resolve case context
- **THEN** it does not present case-only fields such as `case.status` or `case.priority`

#### Scenario: Case event does not expose message-only fields
- **WHEN** the frontend renders condition fields for a case event
- **THEN** it does not present message-only fields such as `message.text`

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

### Requirement: Unified Contact Tagging Emits contact.tagged

All contact-tagging write paths — manual tagging, short-link click auto-tag, and automation `add_tag` — SHALL result in a `contact.tagged` event being emitted, so that automation rules triggered by tagging fire consistently regardless of which path added the tag. Tagging SHALL remain idempotent (adding an existing tag SHALL NOT duplicate). The `contact.tagged` event SHALL carry a `source` field ('agent' | 'system' | 'automation') indicating which path added it.

#### Scenario: Short-link click auto-tag emits event

- **WHEN** a contact clicks a short link with `tagOnClick` set
- **THEN** the tag is added (idempotently) and a `contact.tagged` event with source 'system' is emitted

#### Scenario: Automation add_tag emits event

- **WHEN** an automation `add_tag` action tags a contact
- **THEN** a `contact.tagged` event with source 'automation' is emitted (bridged from the worker process to the API event bus)

#### Scenario: Manual tagging still emits event

- **WHEN** an agent manually tags a contact
- **THEN** a `contact.tagged` event with source 'agent' is emitted (existing behaviour preserved)

### Requirement: Tagging Write Path Is Shared Where Possible

Within the API process, contact-tagging SHALL go through a single shared function (`addTagToTarget`) rather than duplicated find-then-create logic. The shared function SHALL accept a tag source ('agent' | 'system' | 'automation'), defaulting to 'agent' so existing callers are unaffected; agent id SHALL be optional (non-agent sources have no agent).

#### Scenario: Click path uses the shared tagging function

- **WHEN** the short-link click path adds a tag
- **THEN** it calls the shared `addTagToTarget` with source 'system', not its own create logic

#### Scenario: Existing manual callers unaffected

- **WHEN** an existing manual-tagging caller invokes `addTagToTarget` without specifying source
- **THEN** the source defaults to 'agent' and behaviour is unchanged

### Requirement: Tagging Loop Protection

The system SHALL prevent infinite tagging loops. A `contact.tagged` event whose source is 'automation' SHALL NOT itself trigger further automation `add_tag` actions (self-triggering is broken). Human ('agent') and click ('system') tagging MAY trigger automation.

#### Scenario: Automation-sourced tag does not re-trigger tagging

- **WHEN** an automation rule adds a tag, emitting `contact.tagged` with source 'automation'
- **THEN** that event does not trigger another add_tag, preventing an infinite loop

#### Scenario: Human/click tag can trigger automation

- **WHEN** a tag is added by an agent or by a short-link click
- **THEN** the resulting `contact.tagged` may trigger automation rules

### Requirement: Short Link Click Trigger Event

The automation engine SHALL recognize `link.clicked` as a valid trigger event, emitted when a short link is clicked. The event SHALL be selectable as a rule trigger in the automation UI and pass contract validation. The event SHALL provide `tenant` and `contact` scopes; when the click cannot be resolved to a contact (anonymous click), contact-scoped actions SHALL be skipped without failing the rule.

#### Scenario: link.clicked is a valid trigger

- **WHEN** an automation rule is composed with trigger `link.clicked`
- **THEN** contract validation accepts it (does not reject as unknown event)
- **AND** the automation UI lists "短連結被點擊" as a selectable trigger

#### Scenario: Rule fires on short link click

- **WHEN** a contact clicks a short link that resolves to a known contact
- **THEN** the `link.clicked` event fires and any matching automation rule executes

#### Scenario: Anonymous click does not break the rule

- **WHEN** a short link click cannot be resolved to a contact
- **THEN** the rule's contact-scoped actions are skipped and the rule does not error

### Requirement: Short Link Click Facts

The `link.clicked` event SHALL provide facts including `shortLinkId`, `slug`, and (when available) `contactId`, so rule conditions can target which specific short link was clicked.

#### Scenario: Condition on specific short link

- **WHEN** a rule condition is "slug equals a specific value"
- **THEN** the rule only executes for clicks on that short link, not others

### Requirement: Add Tag Worker Action

The worker-side automation action executor SHALL support an `add_tag` action that adds a tag to the triggering contact. The action SHALL be idempotent (adding an already-present tag SHALL NOT create a duplicate). When no contact is available in context, the action SHALL be skipped with a log entry and SHALL NOT error. The tag write SHALL go through the tenant-bound connection (SHALL NOT bypass RLS).

#### Scenario: Add tag to contact on rule execution

- **WHEN** a rule with an `add_tag` action executes for a contact
- **THEN** the specified tag is added to that contact

#### Scenario: Adding an existing tag is idempotent

- **WHEN** an `add_tag` action targets a contact that already has the tag
- **THEN** no duplicate tag association is created

#### Scenario: Missing contact skips gracefully

- **WHEN** an `add_tag` action executes with no contact in context
- **THEN** the action is skipped with a log entry and the rule does not fail

### Requirement: End-to-End Click-to-Tag Rule Path

The system SHALL support the full path: a short link click emits `link.clicked` → a matching automation rule runs → an `add_tag` action tags the clicking contact. This path SHALL coexist with the existing direct `tagOnClick` field on short links; both may apply to the same click, and idempotent tagging SHALL prevent duplicates.

#### Scenario: Click-to-tag via automation rule

- **WHEN** a contact clicks a short link and a rule with trigger `link.clicked` + action `add_tag` exists
- **THEN** the contact receives the tag via the rule path

#### Scenario: Direct path and rule path coexist

- **WHEN** a short link has both `tagOnClick` set and a matching `link.clicked` rule
- **THEN** both paths run and the contact ends with the tag(s) without duplicates
