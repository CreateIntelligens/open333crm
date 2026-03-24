## Automation Engine Requirements

### Requirement: Event-Driven Triggers
The system SHALL evaluate rules immediately when relevant events occur on the Event Bus.

#### Scenario: Tagging a VIP on message received
- **GIVEN** a rule that tags contacts as `VIP` if they mention "Platinum"
- **WHEN** a `message.received` event contains the keyword "Platinum"
- **THEN** the `add_tag` action is executed for that contact

### Requirement: Delayed Actions
The system SHALL support delayed execution of actions (e.g., sending a survey 24 hours after resolution).
