## MODIFIED Requirements

### Requirement: Rule Conditions
The system SHALL persist automation rule conditions using the `conditions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `conditionsJson` in database operations.

#### Scenario: Creating a rule with conditions
- **WHEN** a new automation rule is created via the API
- **THEN** the conditions are written to the `conditions` Prisma field only

#### Scenario: Updating a rule's conditions
- **WHEN** an automation rule is updated with new conditions
- **THEN** the conditions are written to the `conditions` Prisma field only

### Requirement: Actions
The system SHALL persist automation rule actions using the `actions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `actionsJson` in database operations.

#### Scenario: Creating a rule with actions
- **WHEN** a new automation rule is created via the API
- **THEN** the actions are written to the `actions` Prisma field only

#### Scenario: Updating a rule's actions
- **WHEN** an automation rule is updated with new actions
- **THEN** the actions are written to the `actions` Prisma field only
