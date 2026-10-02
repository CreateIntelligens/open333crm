## MODIFIED Requirements

### Requirement: Actions
The system SHALL support automation actions such as `add_tag`, `send_message`, `update_case_status`, and `notify_supervisor`. The system SHALL persist automation rule actions using the `actions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `actionsJson` in database operations. Actions accepted from the frontend SHALL be validated against the composed automation contract for the selected event before an active rule is saved or tested.

Actions that the workers do not implement yet SHALL be listed in `UNSUPPORTED_AUTOMATION_ACTION_TYPES` (`create_case`, `remove_tag`, `assign_bot`, `kb_auto_reply`, `llm_reply`). The rule editor SHALL NOT offer them, and the API SHALL reject a new or modified rule that contains them. The workers SHALL still run the other actions of an existing rule that contains them, skip only those actions, and the rule list and editor SHALL mark such rules. Updating only the active state, name, description or priority of a rule SHALL NOT re-validate its contract.

#### Scenario: Auto-tagging
- **WHEN** a rule with `add_tag("hot_lead")` matches
- **THEN** the `hot_lead` tag is attached to the contact

#### Scenario: Creating a rule with actions
- **WHEN** a new automation rule is created via the API
- **THEN** the actions are written to the `actions` Prisma field only

#### Scenario: Updating a rule's actions
- **WHEN** an automation rule is updated with new actions
- **THEN** the actions are written to the `actions` Prisma field only

#### Scenario: Event-incompatible action is rejected
- **WHEN** the frontend or API submits an action whose required context is not available for the selected event
- **THEN** the API rejects the rule with a validation error and does not persist the invalid action

#### Scenario: Unsupported action is rejected
- **WHEN** an administrator creates or modifies a rule whose actions include `create_case`
- **THEN** the API returns HTTP 400 with a message that「建立工單」is not supported for automatic execution yet

#### Scenario: Existing rule still runs its other actions
- **WHEN** an existing active rule contains `send_message` and `create_case`, and its conditions match
- **THEN** the workers run `send_message`, skip `create_case`, and do not skip the whole rule

#### Scenario: Disabling a rule that contains an unsupported action
- **WHEN** an administrator changes only the active state or name of a rule that contains an unsupported action
- **THEN** the update succeeds

#### Scenario: Rule list marks the rule
- **WHEN** a rule contains an unsupported action
- **THEN** the rule list shows「含未支援的動作」next to it, and the editor explains which actions will not run and will be removed on save
