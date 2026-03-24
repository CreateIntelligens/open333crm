## ADDED Requirements

### Requirement: Case Status Lifecycle
The system SHALL support cases that progress through predefined statuses: open, in_progress, pending, resolved, closed.

#### Scenario: Closing a resolved case
- **WHEN** an agent marks a resolved case as closed
- **THEN** the system records a `CaseEvent` and updates the `closed_at` timestamp

### Requirement: SLA Monitoring
The system SHALL track the SLA deadline for active cases and trigger escalation events if exceeded.

#### Scenario: SLA Breach triggers escalation
- **WHEN** a case remains unassigned past its SLA deadline
- **THEN** the system updates its priority to urgent and triggers a `case.sla_warning` event
