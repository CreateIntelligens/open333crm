## MODIFIED Requirements

### Requirement: Actions
The system SHALL support automation actions such as `add_tag`, `send_message`, `create_case`, `update_case_status`, and `notify_supervisor`. The system SHALL persist automation rule actions using the `actions` JSON field in the Prisma `AutomationRule` model. The field SHALL NOT be written using any alias such as `actionsJson` in database operations. Actions accepted from the frontend SHALL be validated against the composed automation contract for the selected event before an active rule is saved or tested. `create_case` SHALL require the contact and conversation scopes, so it is offered only for message, postback, keyword and conversation-created events.

Actions that the workers do not implement yet SHALL be listed in `UNSUPPORTED_AUTOMATION_ACTION_TYPES` (`remove_tag`, `assign_bot`, `kb_auto_reply`, `llm_reply`). The rule editor SHALL NOT offer them, and the API SHALL reject a new or modified rule that contains them. The workers SHALL still run the other actions of an existing rule that contains them, skip only those actions, and the rule list and editor SHALL mark such rules. Updating only the active state, name, description or priority of a rule SHALL NOT re-validate its contract.

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
- **WHEN** an administrator creates or modifies a rule whose actions include `llm_reply`
- **THEN** the API returns HTTP 400 with a message that「LLM 智能回覆」is not supported for automatic execution yet

#### Scenario: Existing rule still runs its other actions
- **WHEN** an existing active rule contains `send_message` and `llm_reply`, and its conditions match
- **THEN** the workers run `send_message`, skip `llm_reply`, and do not skip the whole rule

#### Scenario: Disabling a rule that contains an unsupported action
- **WHEN** an administrator changes only the active state or name of a rule that contains an unsupported action
- **THEN** the update succeeds

#### Scenario: Rule list marks the rule
- **WHEN** a rule contains an unsupported action
- **THEN** the rule list shows「含未支援的動作」next to it, and the editor explains which actions will not run and will be removed on save

## ADDED Requirements

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

