## MODIFIED Requirements

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
