## MODIFIED Requirements

### Requirement: Fact And Action Definitions
Fact definitions SHALL declare their fact key, label, type, allowed operators, value options when applicable, and required scopes. Action definitions SHALL declare their action type, label, required scopes, mutated scopes, and parameter metadata. The status options of `update_case_status` SHALL include every Case status, including `PENDING`.

#### Scenario: Action declares required context
- **WHEN** the contract defines `update_case_status`
- **THEN** the action definition requires case context before it can be selected for an event

#### Scenario: Case status action offers pending
- **WHEN** the contract lists the status options of `update_case_status`
- **THEN** the options include `PENDING` with the label「待處理」, and a rule that sets status `PENDING` passes validation

### Requirement: Contract Compatibility Validation
The system SHALL provide validation helpers that verify a rule's event name, condition tree, condition facts, operators, and actions against the composed contract for that event. Validation SHALL reject unknown events, unknown facts, unsupported operators, missing values for value-required operators, actions whose required scopes are unavailable for the selected event, and a `select` action parameter whose value is not one of the parameter's options. An empty optional `select` parameter SHALL pass.

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
