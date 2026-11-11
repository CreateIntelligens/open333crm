## Purpose
定義自動化規則契約：事件、事實、動作的目錄，依事件組合可用的條件與動作，解析器語意，前端可直接使用的契約資料，以及規則與事件的相容性驗證。

## Requirements

### Requirement: Automation Contract Catalog
The system SHALL define automation event, fact, action, operator, and scope metadata in a package-level contract that can be consumed by web, API, and worker code. Event definitions SHALL declare their event name, label, category, native provided scopes, and any explicitly resolvable scopes.

#### Scenario: Message event declares message context
- **WHEN** the contract defines `message.received`
- **THEN** the event definition includes message-related scopes such as tenant, contact, conversation, and message

#### Scenario: Case event declares case context
- **WHEN** the contract defines `case.created`
- **THEN** the event definition includes case-related scopes such as tenant, contact, and case

### Requirement: Fact And Action Definitions
Fact definitions SHALL declare their fact key, label, type, allowed operators, value options when applicable, and required scopes. Action definitions SHALL declare their action type, label, required scopes, mutated scopes, and parameter metadata. The status options of `update_case_status` SHALL include every Case status, including `PENDING`.

#### Scenario: Action declares required context
- **WHEN** the contract defines `update_case_status`
- **THEN** the action definition requires case context before it can be selected for an event

#### Scenario: Case status action offers pending
- **WHEN** the contract lists the status options of `update_case_status`
- **THEN** the options include `PENDING` with the label「待處理」, and a rule that sets status `PENDING` passes validation

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
The system SHALL provide validation helpers that verify a rule's event name, condition tree, condition facts, operators, and actions against the composed contract for that event. Validation SHALL reject unknown events, unknown facts, unsupported operators, missing values for value-required operators, actions whose required scopes are unavailable for the selected event, a `select` action parameter whose value is not one of the parameter's options, and an action parameter whose value does not have the parameter's type: a `string`, `textarea`, `agent`, `material` or `coupon` parameter SHALL be a string, a `number` parameter SHALL be a finite number, and a `boolean` parameter SHALL be a boolean. An empty optional `select` parameter SHALL pass. Parameters that the contract does not define SHALL NOT be checked.

#### Scenario: Invalid fact rejected
- **WHEN** validation receives a `case.created` rule whose conditions reference `message.text`
- **THEN** validation fails with an error explaining that the fact is not allowed for the event

#### Scenario: Invalid action rejected
- **WHEN** validation receives a `case.closed` rule whose actions include an action requiring conversation context and the event does not provide or resolve conversation context
- **THEN** validation fails with an error explaining that the action is not allowed for the event

#### Scenario: Valid rule accepted
- **WHEN** validation receives a `message.received` rule using message facts and a conversation-compatible action
- **THEN** validation succeeds

#### Scenario: Select parameter outside the options rejected
- **WHEN** an API client saves a `case.created` rule whose `update_case_status` action has status `FOO`
- **THEN** the API returns 400 with an error that names the action and the parameter, and the rule is not saved

#### Scenario: Empty optional select parameter accepted
- **WHEN** validation receives a `message.received` rule whose `create_case` action has a title and an empty `priority`
- **THEN** validation succeeds

#### Scenario: Text parameter that is not a string rejected
- **WHEN** an API client saves a `message.received` rule whose `send_message` action has `text` `{ "a": 1 }`, or whose `add_tag` action has `tagName` `123`
- **THEN** the API returns 400 with the error「第 1 個動作「傳送訊息」的「訊息內容」必須是文字」(or the matching action and parameter), and the rule is not saved

#### Scenario: Parameters sent by the rule editor accepted
- **WHEN** validation receives a `message.received` rule with the parameters that the rule editor sends: `send_message` with `text`, `create_case` with `title`, `priority` and `category`, `add_tag` with `tagName`, and `send_material` with `materialId`, all strings
- **THEN** validation succeeds

#### Scenario: Parameters not in the contract are not checked
- **WHEN** validation receives a `send_material` action with `materialId` and `variables` `{ "name": "王" }`
- **THEN** validation succeeds

### Requirement: Contract Validation Errors Use Contract Labels
Each validation error SHALL be written in Traditional Chinese, name the position of the condition or action, and use the contract labels of the event, fact, operator, action and parameter. When the contract does not define a fact or an action at all, the error SHALL quote the raw value and say that the system does not provide it.

#### Scenario: Error message uses Chinese labels
- **WHEN** validation receives a `message.received` rule whose second action is `auto_assign`, which the contract does not define
- **THEN** the error is「第 2 個動作「auto_assign」不是系統提供的動作，請刪除」and contains no English text other than the raw type
