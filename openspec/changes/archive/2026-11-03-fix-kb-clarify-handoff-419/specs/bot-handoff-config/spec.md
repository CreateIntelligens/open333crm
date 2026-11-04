## ADDED Requirements

### Requirement: 知識庫追問用完或 AI 失敗時轉接真人

知識庫自動回覆的追問次數已達 `clarifyMaxAttempts`，或追問的 LLM 呼叫失敗（含 `PLAN_LIMIT_EXCEEDED`）時，系統 SHALL 在寫入「已為您轉接客服人員」回覆的同一個交易，以條件更新把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`、寫入 `handoffReason` 與一則系統訊息、發出 `conversation.handoff`，並在 commit 後推播到渠道房間。追問次數 SHALL 歸零。條件不成立時，系統 SHALL NOT 寫入或送出這則回覆。

#### Scenario: 追問次數用完
- **WHEN** `clarifyMaxAttempts` 為 2，對話的追問次數為 2，客人傳送知識庫找不到答案的文字
- **THEN** 客人收到一則「已為您轉接客服人員」，對話為 `AGENT_HANDLED`、`handoffReason` 說明追問次數已達上限，對話有一則系統訊息，系統發出一個 `conversation.handoff`，`conversation.updated` 推播到渠道房間、不推到 tenant 房間，追問次數為 0

#### Scenario: LLM 呼叫失敗
- **WHEN** 追問的 LLM 呼叫丟出 `PLAN_LIMIT_EXCEEDED`（月額度用完）或其他錯誤
- **THEN** 客人收到「已為您轉接客服人員」，對話為 `AGENT_HANDLED`，月額度用完時 `handoffReason` 說明 AI 月額度已用完，系統發出一個 `conversation.handoff`

#### Scenario: 轉接後客人再傳訊息
- **WHEN** 對話因追問用完轉接之後，客人再傳一則文字
- **THEN** 客人 SHALL NOT 再收到「已為您轉接客服人員」或任何 KB 回覆，系統 SHALL NOT 再發出 `conversation.handoff`

#### Scenario: 同一則訊息處理兩次
- **WHEN** 觸發追問用完的 `message.received` 被處理兩次
- **THEN** 客人只收到一則轉接訊息，對話只有一則轉接系統訊息，系統只發出一個 `conversation.handoff`

#### Scenario: 寫入系統訊息失敗
- **WHEN** 轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 對話仍是 `BOT_HANDLED`，沒有機器人回覆、沒有 `conversation.handoff`，客人沒有收到轉接訊息，處理失敗並由佇列重試

#### Scenario: 還沒用完追問次數
- **WHEN** `clarifyMaxAttempts` 為 2，對話的追問次數為 1，客人傳送知識庫找不到答案的文字
- **THEN** 系統照常追問，追問次數變成 2，對話仍是 `BOT_HANDLED`

### Requirement: 轉接後關鍵字規則照常回覆

命中能在該渠道回覆的 `keyword.matched` 規則的訊息，知識庫自動回覆 SHALL 讓步，這則訊息不算追問，也不觸發追問用完的轉接。對話轉接成 `AGENT_HANDLED` 之後，系統 SHALL 照常以這則訊息評估關鍵字規則並執行其動作；知識庫自動回覆與 agent 回覆 SHALL NOT 回覆 `AGENT_HANDLED` 的對話。

#### Scenario: 轉接後客人傳送關鍵字
- **WHEN** 對話因追問用完轉接成 `AGENT_HANDLED` 之後，客人傳送文字「營業時間」
- **THEN** 系統以「營業時間」送出這則訊息的關鍵字規則評估，知識庫自動回覆不再回覆

### Requirement: 轉接真人時通知客服

系統發出 `conversation.handoff` 時，SHALL 建立類型為 `conversation_handoff` 的站內通知：對話已指派時只通知負責的客服；沒有指派時通知所有啟用中的主管與管理員。通知內容 SHALL 包含聯絡人名稱與轉接原因，點擊後開啟該對話。

#### Scenario: 未指派的對話轉接
- **WHEN** 沒有指派客服的對話發出 `conversation.handoff`，原因為「追問次數已達上限」
- **THEN** 每位啟用中的主管與管理員各收到一則 `conversation_handoff` 通知，內容含聯絡人名稱與原因，連結為 `/dashboard/inbox?conv=<對話 id>`

#### Scenario: 已指派的對話轉接
- **WHEN** 指派給客服 X 的對話發出 `conversation.handoff`
- **THEN** 只有客服 X 收到 `conversation_handoff` 通知

## MODIFIED Requirements

### Requirement: Webhook intercepts handoff_request postback
The system SHALL intercept LINE postback events with data `handoff_request` in `webhook.service.ts` and treat them as an explicit user request to escalate to a human agent. The interception SHALL occur after CSAT and `kb_feedback` interception, and SHALL return early without publishing the `message.received` event.

#### Scenario: User taps the handoff quick reply
- **WHEN** the webhook receives a postback with `data === 'handoff_request'` on a conversation in `BOT_HANDLED` status
- **THEN** the system SHALL update the conversation `status` to `'AGENT_HANDLED'` with `handoffReason: 'user_requested_handoff'`
- **AND** the system SHALL send the channel `botConfig.handoffMessage` (default `'稍等，正在為您轉接客服人員'`) to the user
- **AND** the system SHALL publish a `conversation.handoff` eventBus event, which notifies agents as "轉接真人時通知客服" specifies (the assigned agent, or every active SUPERVISOR/ADMIN when the conversation is unassigned)
- **AND** the system SHALL NOT publish `message.received`

#### Scenario: Handoff socket events go to the channel rooms
- **WHEN** a conversation of channel C is handed off, by the `handoff_request` postback, by automatic handoff, or by the knowledge-base reply when clarification is exhausted
- **THEN** the system SHALL emit the system message as `message.new` and the status as `conversation.updated` to `tenant:<tenantId>:channel:<C>`, `tenant:<tenantId>:channels:all` and `conversation:<conversationId>`, as for other channel events (`tenant-transaction-context`)
- **AND** a member who cannot see channel C SHALL NOT receive these events

#### Scenario: handoff_request on already AGENT_HANDLED conversation
- **WHEN** the webhook receives `handoff_request` on a conversation already in `AGENT_HANDLED` status
- **THEN** the system SHALL idempotently respond with the handoffMessage without a DB status change
- **AND** the system SHALL NOT republish the handoff event
