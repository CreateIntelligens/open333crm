## ADDED Requirements

### Requirement: Send Material Action References An Existing Material
When an automation rule is created, or updated with new actions, every `send_material` action SHALL have a `materialId` that refers to an active material of the same tenant. Otherwise the system SHALL respond 400 and SHALL NOT save the rule.

#### Scenario: Material ID is not a UUID
- **WHEN** a user creates a keyword reply whose `send_material` action has `materialId = "not-a-uuid"`
- **THEN** the system SHALL respond 400 and SHALL NOT create the rule

#### Scenario: Material does not exist
- **WHEN** a user creates a rule whose `send_material` action refers to a UUID with no material in the tenant
- **THEN** the system SHALL respond 400 and SHALL NOT create the rule

#### Scenario: Material of another tenant
- **WHEN** a user creates a rule whose `send_material` action refers to an active material of another tenant
- **THEN** the system SHALL respond 400

#### Scenario: Existing active material
- **WHEN** a user creates a rule whose `send_material` action refers to an active material of the same tenant
- **THEN** the rule SHALL be created
