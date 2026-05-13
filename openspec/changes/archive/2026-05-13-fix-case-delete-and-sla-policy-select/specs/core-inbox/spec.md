## ADDED Requirements

### Requirement: Inbox Case Creation SLA Policy Selection
The inbox create-case modal SHALL allow a user to select an SLA policy from the available policy options. The selected option SHALL remain visibly selected in the dropdown and the selected policy id SHALL be included in the case creation request when present.

#### Scenario: Select SLA policy option
- **WHEN** a user opens the create-case modal from `/dashboard/inbox` and selects an SLA policy option
- **THEN** the dropdown displays the selected option instead of reverting to the default option

#### Scenario: Submit selected SLA policy
- **WHEN** a user submits the create-case modal after selecting an SLA policy
- **THEN** the create-case request includes the selected SLA policy id

#### Scenario: Use automatic SLA policy
- **WHEN** a user leaves the SLA policy dropdown on the default automatic option
- **THEN** the create-case request omits the explicit SLA policy id and allows backend priority-based policy selection
