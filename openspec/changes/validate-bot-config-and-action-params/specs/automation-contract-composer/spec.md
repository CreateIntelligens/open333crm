## MODIFIED Requirements

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
