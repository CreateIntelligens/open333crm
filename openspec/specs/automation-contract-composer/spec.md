## Requirements

### Requirement: Automation Contract Catalog
The system SHALL define automation event, fact, action, operator, and scope metadata in a package-level contract that can be consumed by web, API, and worker code. Event definitions SHALL declare their event name, label, category, native provided scopes, and any explicitly resolvable scopes. Fact definitions SHALL declare their fact key, label, type, allowed operators, value options when applicable, and required scopes. Action definitions SHALL declare their action type, label, required scopes, mutated scopes, and parameter metadata.

#### Scenario: Message event declares message context
- **WHEN** the contract defines `message.received`
- **THEN** the event definition includes message-related scopes such as tenant, contact, conversation, and message

#### Scenario: Case event declares case context
- **WHEN** the contract defines `case.created`
- **THEN** the event definition includes case-related scopes such as tenant, contact, and case

#### Scenario: Action declares required context
- **WHEN** the contract defines `update_case_status`
- **THEN** the action definition requires case context before it can be selected for an event

### Requirement: Event Contract Composer
The system SHALL provide a composer function that accepts an automation event name and returns the event definition plus the facts and actions that are valid for that event. A fact or action SHALL be included only when its required scopes are available from the event's native provided scopes or from explicitly enabled resolvable scopes.

#### Scenario: Message event exposes message facts
- **WHEN** the composer builds the authoring contract for `message.received`
- **THEN** it includes message, conversation, and contact facts that only require scopes provided by the event

#### Scenario: Message event excludes case-only facts
- **WHEN** the composer builds the authoring contract for `message.received` without an enabled case resolver
- **THEN** it excludes facts that require only case context, such as `case.status` and `case.priority`

#### Scenario: Case event excludes message-only facts
- **WHEN** the composer builds the authoring contract for `case.created`
- **THEN** it excludes facts that require message context, such as `message.text`

#### Scenario: SLA event exposes SLA facts
- **WHEN** the composer builds the authoring contract for an SLA event such as `sla.resolution.breached`
- **THEN** it includes SLA and case facts allowed for that SLA event

### Requirement: Explicit Resolver Semantics
The system SHALL NOT make cross-entity facts available merely because they might be reachable through database relations. Resolvable scopes SHALL be declared explicitly on event definitions and SHALL be enabled explicitly by the composer before facts or actions requiring those scopes become available.

#### Scenario: Conversation can resolve case only when declared
- **WHEN** an event provides conversation context but does not declare case as resolvable
- **THEN** the composer excludes facts and actions that require case context

#### Scenario: Resolvable scope is enabled
- **WHEN** an event declares case as resolvable and the composer is called with that resolver enabled
- **THEN** the composer may include facts and actions that require case context

### Requirement: UI-Ready Contract Metadata
The composed contract SHALL include UI-ready metadata for condition and action authoring, including localized labels, input value types, select options, supported operators, and valueless operator hints. The frontend SHALL be able to render event-specific condition fields and action choices without maintaining a separate hard-coded list.

#### Scenario: Operator labels are supplied by contract
- **WHEN** the frontend renders a condition field from the composed contract
- **THEN** it uses the operators and labels provided by the contract for that field

#### Scenario: Valueless operator hides value editor
- **WHEN** a user selects an operator such as `exists` or `notExists`
- **THEN** the composed operator metadata allows the condition builder to omit the value input

#### Scenario: Action parameters are supplied by contract
- **WHEN** the frontend renders an action selected from the composed contract
- **THEN** it uses the action parameter metadata to render the required fields

### Requirement: Contract Compatibility Validation
The system SHALL provide validation helpers that verify a rule's event name, condition tree, condition facts, operators, and actions against the composed contract for that event. Validation SHALL reject unknown events, unknown facts, unsupported operators, missing values for value-required operators, and actions whose required scopes are unavailable for the selected event.

#### Scenario: Invalid fact rejected
- **WHEN** validation receives a `case.created` rule whose conditions reference `message.text`
- **THEN** validation fails with an error explaining that the fact is not allowed for the event

#### Scenario: Invalid action rejected
- **WHEN** validation receives a `case.closed` rule whose actions include an action requiring conversation context and the event does not provide or resolve conversation context
- **THEN** validation fails with an error explaining that the action is not allowed for the event

#### Scenario: Valid rule accepted
- **WHEN** validation receives a `message.received` rule using message facts and a conversation-compatible action
- **THEN** validation succeeds
