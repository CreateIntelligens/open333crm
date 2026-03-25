## ADDED Requirements

### Requirement: Event-Driven Rule Execution
The system SHALL evaluate automation rules whenever a defined Trigger event (such as `message.received` or `contact.followed`) occurs.

#### Scenario: Rule triggered by message
- **WHEN** a `message.received` event is fired and a rule's conditions match the message keywords
- **THEN** the engine executes the configured Action, such as sending an auto-reply

### Requirement: Automation Action Variety
The system SHALL support multiple action types including tagging, assigning cases, and calling external webhooks.

#### Scenario: Auto-tagging a contact
- **WHEN** an automation rule's action is `add_tag`
- **THEN** the specified tag is added to the contact's profile
