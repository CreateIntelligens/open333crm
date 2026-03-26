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
