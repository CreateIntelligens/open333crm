## Case Management Requirements

### Requirement: Case State Transitions
The system SHALL strictly enforce the Case status lifecycle.

#### Scenario: Agent resolves an open case
- **GIVEN** a case in `open` or `in_progress` status
- **WHEN** the agent marks it as `resolved`
- **THEN** it enters the `resolved` state and triggers a satisfaction survey event after a delay

### Requirement: Service Level Agreement (SLA)
The system SHALL track response and resolution times based on case priority.

#### Scenario: High priority case SLA warning
- **GIVEN** a `high` priority case that hasn't been responded to in 45 minutes
- **WHEN** the SLA worker runs
- **THEN** it publishes a `case.sla_warning` event

### Requirement: Case Merging
The system SHALL allow merging multiple cases from the same customer into a single primary case.
