## ADDED Requirements

### Requirement: Rule List Shows Every Rule
The automation rule list SHALL show every rule of the tenant, however many rules the tenant has, and the keyword reply list SHALL show every keyword rule. The lists SHALL NOT stop at the first page of the API response. The API SHALL order rules by a unique key after priority and creation time, so that consecutive pages neither repeat nor skip a rule.

#### Scenario: Tenant has more rules than one page
- **WHEN** a tenant has 155 automation rules and the API returns at most 100 rules per page
- **THEN** the rule list requests every page and shows all 155 rules

#### Scenario: Tenant has no rules
- **WHEN** the API returns no rules
- **THEN** the rule list requests one page and shows the empty state

#### Scenario: Rules share priority and creation time
- **WHEN** the API lists rules
- **THEN** it orders them by priority, then creation time, then id

#### Scenario: A page fails to load
- **WHEN** one page request fails
- **THEN** the rule list shows a load error instead of the empty state

### Requirement: Rule Editor Loads Only Contract Actions
When the rule editor loads an existing rule, it SHALL drop every action that the contract of the rule's event does not offer, including entries that are not valid action objects, and it SHALL list the dropped actions with their labels, or as「未知動作（<type>）」when the contract does not define the action. The editor SHALL tell apart actions that the workers skip one by one (`UNSUPPORTED_AUTOMATION_ACTION_TYPES` that the event offers) from actions that make the workers skip the whole rule. The editor SHALL read the rule's event from `trigger.type`, then `eventType`. The list of dropped actions SHALL be shown only while the selected event is the stored event.

#### Scenario: Rule contains an action outside the contract
- **WHEN** an administrator opens a `message.received` rule whose actions are `send_message` and `auto_assign`
- **THEN** the editor keeps `send_message`, drops `auto_assign`, lists it as「未知動作（auto_assign）」, and says that the whole rule does not run until it is saved

#### Scenario: Rule contains an action that the event does not offer
- **WHEN** an administrator opens a `case.closed` rule whose actions include `send_message`
- **THEN** the editor drops `send_message` and shows「傳送訊息」as removed

#### Scenario: Rule contains an unsupported action
- **WHEN** an administrator opens a `message.received` rule whose actions include `llm_reply`
- **THEN** the editor drops `llm_reply` and says that the other actions still run

#### Scenario: Rule has no trigger type
- **WHEN** an administrator opens a rule whose `trigger` has no `type` and whose `eventType` is `case.created`
- **THEN** the editor filters the actions against the `case.created` contract

### Requirement: Rule List Marks Rules The Workers Skip
The rule list SHALL mark each rule that fails contract validation with the options that the workers use (`allowUnsupportedActions`), because the workers skip such a rule entirely and record the reason only in a log. The mark SHALL show the validation errors.

#### Scenario: Rule contains an action outside the contract
- **WHEN** an active `message.received` rule contains `auto_assign`
- **THEN** the rule list shows「規則不會執行」next to it, with the error「第 1 個動作「auto_assign」不是系統提供的動作，請刪除」

#### Scenario: Rule contains only unsupported actions besides valid ones
- **WHEN** an active `message.received` rule contains `send_message` and `llm_reply`
- **THEN** the rule list shows「含未支援的動作」and does not show「規則不會執行」
