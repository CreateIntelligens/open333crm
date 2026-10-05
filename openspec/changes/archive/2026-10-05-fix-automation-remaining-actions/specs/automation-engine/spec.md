## MODIFIED Requirements

### Requirement: Actions
The system SHALL support the automation actions defined in the contract `AUTOMATION_ACTION_DEFINITIONS`, such as `add_tag`, `remove_tag`, `send_message`, `create_case`, `update_case_status`, and `notify_supervisor`. The system SHALL persist automation rule actions using the `actions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `actionsJson` in database operations. Actions accepted from the frontend SHALL be validated against the composed automation contract for the selected event before an active rule is saved or tested. `create_case` SHALL require the contact and conversation scopes, so it is offered only for message, postback, keyword and conversation-created events.

`remove_tag` SHALL remove from the contact the tags of the tenant that match `tagId` or the name, whatever their scope, so that a tag attached by `add_tag` can be removed by the same name. When the contact has no such tag, `remove_tag` SHALL do nothing and SHALL NOT create a tag.

The contract SHALL NOT define `assign_bot`, `kb_auto_reply` or `llm_reply`, and SHALL keep their Traditional Chinese labels in `RETIRED_AUTOMATION_ACTIONS` so that errors and the editor do not show the raw type. The API SHALL reject a new or modified rule that contains an action the contract does not define, and the workers SHALL skip an existing rule that contains one. A database migration SHALL remove these three actions from existing rules when the code is deployed, and SHALL deactivate a rule whose only actions are these, keeping its actions unchanged. Updating only the active state, name, description or priority of a rule SHALL NOT re-validate its contract.

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

#### Scenario: Create case is offered only for events with a conversation
- **WHEN** an administrator edits a rule triggered by `case.created`, an SLA event or a contact event
- **THEN** the editor does not offer「建立工單」, and the API rejects a rule that contains it

#### Scenario: Unsupported action is rejected
- **WHEN** an administrator creates or modifies a rule whose second action is `llm_reply`
- **THEN** the API returns HTTP 400 with the error「第 2 個動作「LLM 智能回覆」已停用，請刪除」

#### Scenario: Existing rule still runs its other actions
- **WHEN** an existing active rule contains `send_message` and `remove_tag`, and its conditions match
- **THEN** the workers run both actions

#### Scenario: Disabling a rule that contains an unsupported action
- **WHEN** an administrator changes only the active state or name of a rule that contains `llm_reply`
- **THEN** the update succeeds

#### Scenario: Rule list marks the rule
- **WHEN** a rule contains `llm_reply`
- **THEN** the rule list shows「規則不會執行」next to it, and the editor lists「LLM 智能回覆（已停用）」and says that the whole rule does not run until it is saved

#### Scenario: Remove tag by name
- **WHEN** a rule with `remove_tag("VIP")` matches and the contact has the `CONTACT`-scope tag「VIP」
- **THEN** the tag is removed from the contact

#### Scenario: Remove a tag that does not exist
- **WHEN** a rule with `remove_tag("不存在的標籤")` matches
- **THEN** the workers skip the action and do not create a tag

#### Scenario: Remove a tag of another scope added by add_tag
- **WHEN** `add_tag("VIP")` attached a `CASE`-scope tag「VIP」to the contact, and a rule with `remove_tag("VIP")` matches
- **THEN** the tag is removed from the contact

#### Scenario: Migration cleans existing rules
- **WHEN** the migration runs on a rule whose actions are `send_message` and `assign_bot`, and on an active rule whose only action is `llm_reply`
- **THEN** the first rule keeps only `send_message`, and the second rule becomes inactive with its actions unchanged

#### Scenario: Retired action in an existing rule
- **WHEN** an existing active rule contains `send_message` and `llm_reply`, and its conditions match
- **THEN** the workers skip the whole rule and log the validation error

### Requirement: Rule Editor Loads Only Contract Actions
When the rule editor loads an existing rule, it SHALL drop every action that the contract of the rule's event does not offer, including entries that are not valid action objects, and it SHALL list the dropped actions with their labels, as「<label>（已停用）」for an action in `RETIRED_AUTOMATION_ACTIONS`, or as「未知動作（<type>）」when the contract does not know the action. Because the workers skip a rule that contains such an action, the editor SHALL say that the whole rule does not run until it is saved. The editor SHALL read the rule's event from `trigger.type`, then `eventType`. The list of dropped actions SHALL be shown only while the selected event is the stored event.

#### Scenario: Rule contains an action outside the contract
- **WHEN** an administrator opens a `message.received` rule whose actions are `send_message` and `auto_assign`
- **THEN** the editor keeps `send_message`, drops `auto_assign`, lists it as「未知動作（auto_assign）」, and says that the whole rule does not run until it is saved

#### Scenario: Rule contains an action that the event does not offer
- **WHEN** an administrator opens a `case.closed` rule whose actions include `send_message`
- **THEN** the editor drops `send_message` and shows「傳送訊息」as removed

#### Scenario: Rule contains an unsupported action
- **WHEN** an administrator opens a `message.received` rule whose actions include `llm_reply`
- **THEN** the editor drops `llm_reply`, lists it as「LLM 智能回覆（已停用）」, and says that the whole rule does not run until it is saved

#### Scenario: Rule has no trigger type
- **WHEN** an administrator opens a rule whose `trigger` has no `type` and whose `eventType` is `case.created`
- **THEN** the editor filters the actions against the `case.created` contract

### Requirement: Rule List Marks Rules The Workers Skip
The rule list SHALL mark each rule that fails contract validation, because the workers skip such a rule entirely and record the reason only in a log. The mark SHALL show the validation errors.

#### Scenario: Rule contains an action outside the contract
- **WHEN** an active `message.received` rule contains `auto_assign`
- **THEN** the rule list shows「規則不會執行」next to it, with the error「第 1 個動作「auto_assign」不是系統提供的動作，請刪除」

#### Scenario: Rule contains only unsupported actions besides valid ones
- **WHEN** an active `message.received` rule contains `send_message` and `llm_reply`
- **THEN** the rule list shows「規則不會執行」, with the error「第 2 個動作「LLM 智能回覆」已停用，請刪除」
