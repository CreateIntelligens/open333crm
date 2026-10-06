## Purpose

Define automation rule triggers, conditions evaluation, action execution, and SLA contracts for open333CRM.
## Requirements
### Requirement: Event Trigger
The system SHALL trigger automation rules when an event occurs, such as `message.received`.

#### Scenario: Trigger on inbound message
- **WHEN** an inbound message is received in any channel
- **THEN** matching automation rules are evaluated

### Requirement: Rule Conditions
The system SHALL support evaluating complex boolean conditions on message, contact, conversation, case, SLA, and event facts using `json-rules-engine`. The system SHALL persist automation rule conditions using the `conditions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `conditionsJson` in database operations. Conditions accepted from the frontend SHALL use the `json-rules-engine` top-level condition format and SHALL be validated against the composed automation contract for the selected event before an active rule is saved or tested.

#### Scenario: Matching VIP customer
- **WHEN** a rule requires `contact.membership == "VIP"` and `message.sentiment == "negative"`
- **THEN** the rule matches only if both conditions are true

#### Scenario: Creating a rule with conditions
- **WHEN** a new automation rule is created via the API
- **THEN** the conditions are written to the `conditions` Prisma field only

#### Scenario: Updating a rule's conditions
- **WHEN** an automation rule is updated with new conditions
- **THEN** the conditions are written to the `conditions` Prisma field only

#### Scenario: Frontend rule JSON is valid
- **WHEN** the frontend submits a valid `json-rules-engine` condition tree for an automation rule
- **THEN** the API stores the condition tree unchanged in `AutomationRule.conditions`

#### Scenario: Frontend rule JSON is invalid
- **WHEN** the frontend submits a malformed condition tree for an active automation rule
- **THEN** the API rejects the request with a validation error and does not activate the rule

#### Scenario: Event-incompatible fact is rejected
- **WHEN** the frontend or API submits a condition fact that is not allowed by the composed contract for the selected event
- **THEN** the API rejects the rule with a validation error and does not persist the invalid condition

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

### Requirement: Worker-Owned Automation Triggering
The automation engine SHALL use the BullMQ worker path for event-triggered automation rule evaluation. When the API's EventBus automation subscriber fires, it SHALL enqueue a job on the `automation` BullMQ queue with the trigger event name and entity context as the job payload. The API process SHALL NOT call `triggerAutomation()` inline from event subscribers. The standalone worker process consumes this job, builds automation facts using its own `PrismaClient` instance, evaluates rule conditions with `json-rules-engine`, and executes actions only for matched rules.

#### Scenario: Automation event enqueued by API
- **WHEN** an internal EventBus event matching an automation trigger fires in the API process
- **THEN** the API enqueues an `automation:evaluate` job and does not execute automation actions inline

#### Scenario: Automation triggered via BullMQ worker
- **WHEN** the standalone worker dequeues an automation job
- **THEN** it builds facts, evaluates matching rules with `json-rules-engine`, and applies actions only for matched rules

#### Scenario: Standalone worker is down when job is enqueued
- **WHEN** the `automation` queue worker process is not running
- **THEN** the job remains in the BullMQ queue until the worker restarts and processes it

#### Scenario: Worker rule conditions do not match
- **WHEN** the standalone worker receives an automation job for a rule whose conditions do not match the built facts
- **THEN** the worker does not execute that rule's actions

### Requirement: Package-Defined Rule Contract
The system SHALL define automation event names, condition facts, allowed operators, fact metadata, action metadata, and rule authoring labels in package-level contracts that can be consumed by web, API, and worker code. The frontend SHALL compose rule JSON from this package-defined contract, the API SHALL validate rule CRUD payloads against it, and workers SHALL build facts and dispatch actions using the same fact and action identifiers. SLA events SHALL be part of the same automation contract surface rather than a separate frontend-only or API-only list.

#### Scenario: Frontend composes event-specific rule
- **WHEN** the frontend renders automation rule authoring controls for a selected event
- **THEN** it uses package-defined event, condition, operator, and action metadata instead of hard-coded local lists

#### Scenario: API validates event-specific rule payload
- **WHEN** the API receives an automation rule CRUD request
- **THEN** it validates the event name, condition facts, operators, action types, action params, and `json-rules-engine` structure against the composed contract before persisting the rule

#### Scenario: Worker evaluates contract facts
- **WHEN** the worker evaluates automation rules
- **THEN** it builds facts using fact keys defined by the package-level contract and evaluates conditions with `json-rules-engine`

#### Scenario: Message event does not expose case-only fields
- **WHEN** the frontend renders condition fields for a message event that does not explicitly resolve case context
- **THEN** it does not present case-only fields such as `case.status` or `case.priority`

#### Scenario: Case event does not expose message-only fields
- **WHEN** the frontend renders condition fields for a case event
- **THEN** it does not present message-only fields such as `message.text`

### Requirement: SLA Event Catalog
The system SHALL provide an initial SLA event catalog with these worker-originated events: `sla.first_response.warning`, `sla.first_response.breached`, `sla.resolution.warning`, `sla.resolution.breached`, and `sla.customer_waiting.breached`. Each event SHALL define a label, description, allowed fact keys, and supported operators for frontend rule authoring and API validation.

#### Scenario: First response warning event
- **WHEN** the SLA worker detects that an active Case is close to its first-response deadline
- **THEN** it evaluates rules for `sla.first_response.warning`

#### Scenario: First response breach event
- **WHEN** the SLA worker detects that an active Case has no first response after its first-response deadline
- **THEN** it evaluates rules for `sla.first_response.breached`

#### Scenario: Resolution warning event
- **WHEN** the SLA worker detects that an active Case is close to its resolution deadline
- **THEN** it evaluates rules for `sla.resolution.warning`

#### Scenario: Resolution breach event
- **WHEN** the SLA worker detects that an active Case is past its resolution deadline
- **THEN** it evaluates rules for `sla.resolution.breached`

#### Scenario: Customer waiting breach event
- **WHEN** the SLA worker detects that the same Case has reached the configured customer-message-without-agent-reply threshold
- **THEN** it evaluates rules for `sla.customer_waiting.breached`

### Requirement: SLA Automation Facts
The automation engine SHALL expose SLA-related facts for worker-triggered automation evaluation. SLA facts SHALL include case id, tenant id, assignee id, priority, SLA due time, SLA kind, warning/breach state, elapsed/remaining time, customer-message waiting counters, and persisted sentiment facts where available. The SLA worker SHALL NOT perform LLM sentiment analysis; it SHALL only read sentiment facts produced by another service.

#### Scenario: SLA warning facts are evaluated
- **WHEN** an SLA warning event is evaluated by the automation engine
- **THEN** rules can match on facts such as `sla.state`, `sla.kind`, `sla.dueAt`, `sla.remainingMinutes`, `case.priority`, and `case.assigneeId`

#### Scenario: SLA breach facts are evaluated
- **WHEN** an SLA breach event is evaluated by the automation engine
- **THEN** rules can match on facts such as `sla.state`, `sla.kind`, `sla.overdueMinutes`, `case.priority`, and `case.assigneeId`

#### Scenario: Customer waiting facts are evaluated
- **WHEN** a customer waiting breach event is evaluated by the automation engine
- **THEN** rules can match on facts such as `case.customerMessagesSinceLastAgentReply`, `case.lastAgentReplyAt`, `case.lastCustomerMessageAt`, `case.priority`, and `case.assigneeId`

#### Scenario: Persisted sentiment facts are available
- **WHEN** another service has persisted sentiment facts for a Case
- **THEN** SLA rules can match on facts such as `sentiment.latest` and `sentiment.negativeCount` without the SLA worker performing sentiment analysis

#### Scenario: SLA rule action runs after match
- **WHEN** an SLA automation rule matches the built facts
- **THEN** the engine executes the configured actions in priority order using the same action semantics as other automation triggers

### Requirement: Shared SLA Domain Semantics
SLA status names, SLA-only event names, condition metadata, priority bump semantics, fact keys, and pure deadline/status calculations SHALL be provided by a shared package consumed by API, worker, and web code. Application code SHALL NOT maintain separate local copies of these rules.

#### Scenario: Web displays SLA countdown
- **WHEN** the web app renders an SLA countdown or badge
- **THEN** it uses shared SLA status/deadline helpers so its warning and breach states match backend evaluation

#### Scenario: API creates SLA-backed case
- **WHEN** the API creates a Case with an SLA policy
- **THEN** it uses shared SLA priority/deadline semantics where applicable instead of duplicating local constants

#### Scenario: Worker evaluates SLA state
- **WHEN** the SLA worker scans active Cases
- **THEN** it uses shared SLA status and priority helpers so worker behavior matches API and web expectations

#### Scenario: Package metadata changes
- **WHEN** a new SLA event or condition fact is added to the package-defined contract
- **THEN** frontend authoring, API validation, and worker evaluation can consume the new definition without maintaining three independent lists

### Requirement: Unified Contact Tagging Emits contact.tagged

All contact-tagging write paths — manual tagging, short-link click auto-tag, and automation `add_tag` — SHALL result in a `contact.tagged` event being emitted, so that automation rules triggered by tagging fire consistently regardless of which path added the tag. Tagging SHALL remain idempotent (adding an existing tag SHALL NOT duplicate). The `contact.tagged` event SHALL carry a `source` field ('agent' | 'system' | 'automation') indicating which path added it.

#### Scenario: Short-link click auto-tag emits event

- **WHEN** a contact clicks a short link with `tagOnClick` set
- **THEN** the tag is added (idempotently) and a `contact.tagged` event with source 'system' is emitted

#### Scenario: Automation add_tag emits event

- **WHEN** an automation `add_tag` action tags a contact
- **THEN** a `contact.tagged` event with source 'automation' is emitted (bridged from the worker process to the API event bus)

#### Scenario: Manual tagging still emits event

- **WHEN** an agent manually tags a contact
- **THEN** a `contact.tagged` event with source 'agent' is emitted (existing behaviour preserved)

### Requirement: Tagging Write Path Is Shared Where Possible

Within the API process, contact-tagging SHALL go through a single shared function (`addTagToTarget`) rather than duplicated find-then-create logic. The shared function SHALL accept a tag source ('agent' | 'system' | 'automation'), defaulting to 'agent' so existing callers are unaffected; agent id SHALL be optional (non-agent sources have no agent).

#### Scenario: Click path uses the shared tagging function

- **WHEN** the short-link click path adds a tag
- **THEN** it calls the shared `addTagToTarget` with source 'system', not its own create logic

#### Scenario: Existing manual callers unaffected

- **WHEN** an existing manual-tagging caller invokes `addTagToTarget` without specifying source
- **THEN** the source defaults to 'agent' and behaviour is unchanged

### Requirement: Tagging Loop Protection

The system SHALL prevent infinite tagging loops. A `contact.tagged` event whose source is 'automation' SHALL NOT itself trigger further automation `add_tag` actions (self-triggering is broken). Human ('agent') and click ('system') tagging MAY trigger automation.

#### Scenario: Automation-sourced tag does not re-trigger tagging

- **WHEN** an automation rule adds a tag, emitting `contact.tagged` with source 'automation'
- **THEN** that event does not trigger another add_tag, preventing an infinite loop

#### Scenario: Human/click tag can trigger automation

- **WHEN** a tag is added by an agent or by a short-link click
- **THEN** the resulting `contact.tagged` may trigger automation rules

### Requirement: Short Link Click Trigger Event

The automation engine SHALL recognize `link.clicked` as a valid trigger event, emitted when a short link is clicked. The event SHALL be selectable as a rule trigger in the automation UI and pass contract validation. The event SHALL provide `tenant` and `contact` scopes; when the click cannot be resolved to a contact (anonymous click), contact-scoped actions SHALL be skipped without failing the rule.

#### Scenario: link.clicked is a valid trigger

- **WHEN** an automation rule is composed with trigger `link.clicked`
- **THEN** contract validation accepts it (does not reject as unknown event)
- **AND** the automation UI lists "短連結被點擊" as a selectable trigger

#### Scenario: Rule fires on short link click

- **WHEN** a contact clicks a short link that resolves to a known contact
- **THEN** the `link.clicked` event fires and any matching automation rule executes

#### Scenario: Anonymous click does not break the rule

- **WHEN** a short link click cannot be resolved to a contact
- **THEN** the rule's contact-scoped actions are skipped and the rule does not error

### Requirement: Short Link Click Facts

The `link.clicked` event SHALL provide facts including `shortLinkId`, `slug`, and (when available) `contactId`, so rule conditions can target which specific short link was clicked.

#### Scenario: Condition on specific short link

- **WHEN** a rule condition is "slug equals a specific value"
- **THEN** the rule only executes for clicks on that short link, not others

### Requirement: Add Tag Worker Action

The worker-side automation action executor SHALL support an `add_tag` action that adds a tag to the triggering contact. The action SHALL be idempotent (adding an already-present tag SHALL NOT create a duplicate). When no contact is available in context, the action SHALL be skipped with a log entry and SHALL NOT error. The tag write SHALL go through the tenant-bound connection (SHALL NOT bypass RLS).

#### Scenario: Add tag to contact on rule execution

- **WHEN** a rule with an `add_tag` action executes for a contact
- **THEN** the specified tag is added to that contact

#### Scenario: Adding an existing tag is idempotent

- **WHEN** an `add_tag` action targets a contact that already has the tag
- **THEN** no duplicate tag association is created

#### Scenario: Missing contact skips gracefully

- **WHEN** an `add_tag` action executes with no contact in context
- **THEN** the action is skipped with a log entry and the rule does not fail

### Requirement: End-to-End Click-to-Tag Rule Path

The system SHALL support the full path: a short link click emits `link.clicked` → a matching automation rule runs → an `add_tag` action tags the clicking contact. This path SHALL coexist with the existing direct `tagOnClick` field on short links; both may apply to the same click, and idempotent tagging SHALL prevent duplicates.

#### Scenario: Click-to-tag via automation rule

- **WHEN** a contact clicks a short link and a rule with trigger `link.clicked` + action `add_tag` exists
- **THEN** the contact receives the tag via the rule path

#### Scenario: Direct path and rule path coexist

- **WHEN** a short link has both `tagOnClick` set and a matching `link.clicked` rule
- **THEN** both paths run and the contact ends with the tag(s) without duplicates

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

### Requirement: Rule Summary Sentence
The rule list and the rule editor SHALL describe each rule in one Traditional Chinese sentence built from the contract labels: 「當<event>時，如果<conditions>，就<actions>」. Conditions in an `all` group SHALL be joined by「，而且」and in an `any` group by「，或」, with nested groups in parentheses. A rule with no conditions SHALL read「當<event>時，就<actions>」. For a `keyword.matched` rule with keywords, the event part SHALL name the keywords:「訊息含有「A」或「B」」for match mode `any` and「訊息同時含有「A」和「B」」for `all`. A condition node that the summary cannot describe, such as `not`, SHALL be shown as「（無法顯示的條件）」and SHALL NOT be dropped. Each action SHALL show its label and, when it has one, its main text parameter in「」. A parameter that holds an ID, such as `materialId` or `agentId`, SHALL NOT be shown.

#### Scenario: Rule with one condition and one action
- **WHEN** a `message.received` rule has the condition `case.open.count` equal to 0 and the action `create_case` with title「客戶諮詢」
- **THEN** the summary is「當收到訊息時，如果開啟案件數等於 0，就建立工單「客戶諮詢」」

#### Scenario: Rule with any-group conditions
- **WHEN** a rule's conditions are an `any` group of `message.text` contains「退款」and `message.text` contains「客訴」
- **THEN** the conditions read「訊息內容包含「退款」，或訊息內容包含「客訴」」

#### Scenario: Keyword rule names its keywords
- **WHEN** a `keyword.matched` rule has keywords「營業時間」and「幾點開」with match mode `any`, no conditions, and the action `send_message`
- **THEN** the summary starts with「當訊息含有「營業時間」或「幾點開」時」

#### Scenario: Unknown condition node
- **WHEN** a rule's conditions are `{ all: [{ not: { … } }] }`
- **THEN** the conditions read「（無法顯示的條件）」

#### Scenario: Select value shown by label
- **WHEN** a condition compares `case.priority` equal to `HIGH`
- **THEN** the condition reads「案件優先級等於高」

### Requirement: Rule List Is Readable
The rule list SHALL show the event by its contract label, the summary sentence and the active state, and SHALL keep every column visible when a rule name is long. The list SHALL NOT show the execution count while the workers do not update it (AUDIT AUTO-02). The list SHALL let the administrator search rules by name and filter them by active state.

#### Scenario: Event shown by label
- **WHEN** a rule's event is `conversation.created`
- **THEN** the list shows「新對話建立」and not `conversation.created`

#### Scenario: Search by name
- **WHEN** the administrator types「開案」in the search box
- **THEN** the list shows only rules whose name contains「開案」

#### Scenario: Filter by active state
- **WHEN** the administrator selects「已停用」
- **THEN** the list shows only rules with `isActive` false

### Requirement: Rule Editor Uses Plain Language
The rule editor SHALL label `priority` as「執行順序」and explain that a larger number is checked first, SHALL label `stopOnMatch` as「這條規則執行後，不再檢查其他規則」with an explanation, SHALL show the condition builder in Traditional Chinese, and SHALL show the description of the selected event. Events whose `dispatched` is false in the contract SHALL be marked「（目前不會觸發）」in the event menu, and selecting one SHALL show that rules with this event never run.

#### Scenario: Condition builder in Chinese
- **WHEN** the administrator opens the condition section
- **THEN** the controls read「全部符合」「任一符合」「新增條件」「新增條件群組」and no English control text is shown

#### Scenario: Event that never triggers
- **WHEN** the administrator selects「工單關閉」
- **THEN** the menu shows「工單關閉（目前不會觸發）」and the editor warns that rules with this event never run

### Requirement: Rule Test Uses A Form
The rule editor SHALL let the administrator test a saved rule by filling one input for each fact that the rule's conditions use, labeled with the fact's contract label and typed by the fact's type. Each value SHALL be sent in the fact's contract type: a boolean fact as a boolean, a `string_array` fact as an array, and a datetime fact as an ISO 8601 string with a time zone. The result SHALL say in Traditional Chinese whether the rule triggers and, when it does, which actions run. When the conditions match but the rule is inactive, or its event is not dispatched, the result SHALL say that the rule does not run. For a `keyword.matched` rule, the result SHALL say that the message must also contain a keyword. The editor SHALL say that the test runs the saved version of the rule, and SHALL clear the result when the saved rule reloads. When the saved rule has no conditions, the editor SHALL explain, based on the saved rule, whether it runs every time, runs only on a keyword hit, or does not run because it is inactive or its event is not dispatched.

#### Scenario: Inputs follow the conditions
- **WHEN** a rule's conditions use `message.text` and `case.open.count`
- **THEN** the test form shows「訊息內容」as a text input and「開啟案件數」as a number input

#### Scenario: Rule triggers
- **WHEN** the administrator enters 0 for「開啟案件數」and the rule's condition is `case.open.count` equal to 0
- **THEN** the result reads「會觸發」and lists「建立工單「客戶諮詢」」

#### Scenario: Rule does not trigger
- **WHEN** the entered values do not satisfy the conditions
- **THEN** the result reads「不會觸發：條件不符合」

#### Scenario: Conditions match but the rule is inactive
- **WHEN** the entered values satisfy the conditions of an inactive rule
- **THEN** the result reads「條件符合，但規則目前停用，不會執行」

#### Scenario: Inactive rule without conditions
- **WHEN** the administrator opens an inactive rule that has no conditions
- **THEN** the test section reads「這條規則沒有條件，但目前停用，不會執行。」

#### Scenario: Boolean fact
- **WHEN** a rule's condition is `contact.isVip` equal true and the administrator selects「是」
- **THEN** the test sends `contact.isVip` as the boolean true

#### Scenario: Action with an ID parameter
- **WHEN** a rule's action is `send_material` with a `materialId`
- **THEN** the summary shows「傳送素材」without the ID

### Requirement: New Rule Keeps The Chosen Active State
Creating a rule SHALL store the active state that the request sends in `isActive`. When the request does not send `isActive`, the rule SHALL be created active, so that existing API clients keep their behavior.

#### Scenario: Create an inactive rule
- **WHEN** the administrator creates a rule with「啟用這條規則」unchecked
- **THEN** the API stores the rule with `isActive` false, and the rule does not run

#### Scenario: Client that does not send the active state
- **WHEN** an API client creates a rule without `isActive`
- **THEN** the rule is created active

### Requirement: 自動化建立工單
規則的 `create_case` 動作 SHALL 在觸發的對話上建立工單：套用同優先度的 SLA 政策、對話關聯到新工單、寫入 `actorType: automation` 的工單事件、推播並發出 `case.created`；分類 SHALL 只接受系統分類清單內的值。觸發事件為工單或 SLA 相關、沒有對話、或對話已有未結案工單時 SHALL NOT 建立。

#### Scenario: 關鍵字命中時建立工單
- **WHEN** 規則「關鍵字命中『客訴』→ 建立工單（標題『客訴』、優先度 HIGH）」命中，對話尚未關聯工單
- **THEN** 建立一張 OPEN 工單，渠道與聯絡人取自該對話，套用 HIGH 的 SLA 政策，對話關聯到這張工單

#### Scenario: 對話已有未結案工單
- **WHEN** 對話已關聯一張處理中的工單，規則再次命中
- **THEN** 不建立新工單

#### Scenario: 原工單已結案
- **WHEN** 對話關聯的工單已結案，規則再次命中
- **THEN** 建立新工單，對話改關聯到新工單

#### Scenario: 工單事件觸發
- **WHEN** 觸發事件是 `case.created` 等工單或 SLA 事件
- **THEN** 不建立工單；規則編輯器在這些事件也不提供「建立工單」

#### Scenario: 並行處理同一段對話
- **WHEN** 兩個 worker 幾乎同時對同一段尚無工單的對話執行建立工單
- **THEN** 只有一張工單被建立並關聯，另一個回滾、不留下工單

### Requirement: 新工單的自動分類不覆蓋既有分類
API 收到 `case.created` 時 SHALL 只在工單尚無分類時，依對話最新的顧客訊息自動分類。

#### Scenario: 已有分類
- **WHEN** 客服手動建單時選了分類，或自動化規則指定了分類
- **THEN** 不執行自動分類，分類維持原值

