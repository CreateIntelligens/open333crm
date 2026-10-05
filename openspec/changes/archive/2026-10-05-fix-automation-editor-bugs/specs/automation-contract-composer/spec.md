## MODIFIED Requirements

### Requirement: Contract Compatibility Validation
The system SHALL provide validation helpers that verify a rule's event name, condition tree, condition facts, operators, and actions against the composed contract for that event. Validation SHALL reject unknown events, unknown facts, unsupported operators, missing values for value-required operators, and actions whose required scopes are unavailable for the selected event. Each validation error SHALL be written in Traditional Chinese, name the position of the condition or action, and use the contract labels of the event, fact, operator, action and parameter. When the contract does not define a fact or an action at all, the error SHALL quote the raw value and say that the system does not provide it.

#### Scenario: Invalid fact rejected
- **WHEN** validation receives a `case.created` rule whose conditions reference `message.text`
- **THEN** validation fails with an error explaining that the fact is not allowed for the event

#### Scenario: Invalid action rejected
- **WHEN** validation receives a `case.closed` rule whose actions include an action requiring conversation context and the event does not provide or resolve conversation context
- **THEN** validation fails with an error explaining that the action is not allowed for the event

#### Scenario: Valid rule accepted
- **WHEN** validation receives a `message.received` rule using message facts and a conversation-compatible action
- **THEN** validation succeeds

#### Scenario: Error message uses Chinese labels
- **WHEN** validation receives a `message.received` rule whose second action is `auto_assign`, which the contract does not define
- **THEN** the error is「第 2 個動作「auto_assign」不是系統提供的動作，請刪除」and contains no English text other than the raw type
