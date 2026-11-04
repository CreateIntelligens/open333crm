## Purpose

Define per-channel bot handoff prompt configuration for KB auto-replies, including botConfig storage fields, prompt rendering behavior, explicit handoff quick-reply handling, settings UI exposure, and preservation of the existing keyword-based handoff path.

## Requirements

### Requirement: Handoff prompt configurable per channel
The system SHALL store the handoff-to-human prompt configuration in `Channel.settings.botConfig` JSON with three fields: `handoffPromptEnabled` (boolean, default `true`), `handoffPromptStyle` (`'text' | 'button' | 'both' | 'none'`, default `'button'`), and `handoffButtonLabel` (string, default `'💬 轉接客服'`).

#### Scenario: Channel without botConfig fields
- **WHEN** a Channel has no `handoffPromptEnabled` / `handoffPromptStyle` / `handoffButtonLabel` in its `settings.botConfig`
- **THEN** the system SHALL fall back to defaults `true` / `'button'` / `'💬 轉接客服'`

#### Scenario: Admin updates botConfig via settings
- **WHEN** an admin saves new `handoffPromptStyle: 'none'` via the channel settings UI
- **THEN** the value is persisted to `Channel.settings.botConfig.handoffPromptStyle` and takes effect on the next inbound message

### Requirement: KB auto-reply attaches handoff prompt per botConfig
The system SHALL, when sending a KB auto-reply with reply kind `kb_with_handoff` (similarity between `clarifyThreshold` and `0.80`), read the channel's `botConfig.handoffPromptStyle` and attach the handoff prompt accordingly. The hardcoded `HANDOFF_PROMPT` constant in `kb-autoreply.service.ts` SHALL be removed; the default text used when style is `'text'` or `'both'` lives in the BotConfig defaults.

#### Scenario: Style is button (default)
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'button'`
- **THEN** the outbound message SHALL NOT contain the handoff text and SHALL include a quick reply item with `label = handoffButtonLabel` and `postbackData = 'handoff_request'`

#### Scenario: Style is text
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'text'`
- **THEN** the outbound message text SHALL be `<llmReply>\n\n<defaultHandoffPromptText>` and SHALL NOT include the handoff quick reply

#### Scenario: Style is both
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'both'`
- **THEN** the outbound message SHALL include both the text suffix AND the quick reply button

#### Scenario: Style is none
- **WHEN** a KB auto-reply triggers with `kb_with_handoff` and `botConfig.handoffPromptStyle === 'none'`
- **THEN** the outbound message SHALL contain only the LLM reply, no text suffix, no quick reply

#### Scenario: Prompt disabled
- **WHEN** `botConfig.handoffPromptEnabled === false`
- **THEN** the outbound message SHALL contain only the LLM reply regardless of `handoffPromptStyle` value

#### Scenario: KB high confidence reply
- **WHEN** a KB auto-reply triggers with reply kind `kb_high_confidence`
- **THEN** no handoff prompt SHALL be attached (button or text), regardless of botConfig, because `kb_high_confidence` already represents a confident answer

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

### Requirement: BotConfig form exposes handoff prompt fields
The system SHALL expose the three new botConfig fields in the admin `BotConfigForm.tsx` UI: a boolean toggle for `handoffPromptEnabled`, a radio group for `handoffPromptStyle` (4 options), and a text input for `handoffButtonLabel`. The UI SHALL display helper text explaining that when style is `'none'`, users can still trigger handoff by typing keywords (`handoffKeywords`).

#### Scenario: Admin opens BotConfig settings
- **WHEN** an admin opens a LINE channel's BotConfig dialog
- **THEN** the UI SHALL display all three new fields with the channel's current values, or defaults if unset

#### Scenario: Admin saves with style none
- **WHEN** an admin sets `handoffPromptStyle: 'none'` and saves
- **THEN** the UI SHALL show a hint that the user can still type `handoffKeywords` (`真人` / `客服` / ...) to trigger handoff

### Requirement: Existing handoffKeywords path remains active
The system SHALL retain the existing `handoffKeywords` detection logic in `checkAutoHandoff`. Users who type any configured keyword in `botConfig.handoffKeywords` SHALL be auto-handed off regardless of the new `handoffPromptEnabled` / `handoffPromptStyle` settings.

#### Scenario: User types keyword while prompt is disabled
- **WHEN** `handoffPromptEnabled === false` and the user types `真人`
- **THEN** the conversation SHALL still be auto-handed off via the existing `checkAutoHandoff` keyword path

### Requirement: 自動轉接每次只發生一次

自動轉接人工時，系統 MUST 以條件更新把對話從 `BOT_HANDLED` 改成 `AGENT_HANDLED`。只有更新到這筆對話的那一次處理，MUST 寫入系統訊息、送出轉接訊息，並在同一個交易發出 `conversation.handoff`。條件不成立時，系統 MUST NOT 送出轉接訊息，也 MUST NOT 發出 `conversation.handoff`。

#### Scenario: 同一則訊息處理兩次

- **WHEN** 客人的訊息觸發自動轉接，`message.received` 被處理兩次
- **THEN** 客人 MUST 只收到一則轉接訊息，系統 MUST 只發出一個 `conversation.handoff`

#### Scenario: 兩次處理同時進行

- **WHEN** 兩個處理同時判斷同一段 `BOT_HANDLED` 對話要轉接
- **THEN** 只有一個處理 MUST 送出轉接訊息並發出 `conversation.handoff`

#### Scenario: 寫入系統訊息失敗

- **WHEN** 自動轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 對話 MUST 仍是 `BOT_HANDLED`，系統 MUST NOT 送出轉接訊息

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

系統發出 `conversation.handoff` 時，SHALL 建立類型為 `conversation_handoff` 的站內通知：對話已指派、且負責客服仍啟用並看得到該對話渠道時，只通知負責的客服；沒有指派，或負責客服已停用或看不到該渠道時，通知看得到該對話渠道的啟用中主管與管理員（持有 `channel.view_all`，或被授權該渠道），看不到該渠道的人 SHALL NOT 收到。通知內容 SHALL 包含聯絡人名稱與轉接原因，點擊後開啟該對話。

#### Scenario: 未指派的對話轉接
- **WHEN** 沒有指派客服的對話發出 `conversation.handoff`，原因為「追問次數已達上限」
- **THEN** 每位看得到該渠道的啟用中主管與管理員各收到一則 `conversation_handoff` 通知，內容含聯絡人名稱與原因，連結為 `/dashboard/inbox?conv=<對話 id>`

#### Scenario: 已指派的對話轉接
- **WHEN** 指派給客服 X 的對話發出 `conversation.handoff`，X 啟用中且看得到該渠道
- **THEN** 只有客服 X 收到 `conversation_handoff` 通知

#### Scenario: 看不到渠道的主管不收轉接通知
- **WHEN** 渠道 C 上沒有指派客服的對話發出 `conversation.handoff`，主管 S 只被授權渠道 D、沒有 `channel.view_all`
- **THEN** 主管 S 沒有收到這則 `conversation_handoff` 通知

#### Scenario: 負責客服看不到渠道時改通知主管
- **WHEN** 指派給客服 X 的渠道 C 對話發出 `conversation.handoff`，X 已不再被授權渠道 C，總店管理員 H 持有 `channel.view_all`
- **THEN** X 沒有收到通知，H 收到 `conversation_handoff` 通知

### Requirement: AI 與知識庫回覆都因錯誤失敗時轉接真人

客人在 `BOT_HANDLED` 對話傳送文字訊息，agent 沒有送出回覆，而知識庫自動回覆因錯誤沒有送出回覆時（例如去識別化服務、embedding 服務或模型供應商失敗），系統 SHALL 轉接真人：以條件更新把對話改成 `AGENT_HANDLED`、寫入 `handoffReason` 與一則系統訊息、發出 `conversation.handoff`，commit 之後送出渠道的轉接訊息。`handoffReason` SHALL 依錯誤種類寫成客服看得懂的原因，SHALL NOT 包含錯誤內容。寫入系統訊息 SHALL NOT 呼叫去識別化服務。

#### Scenario: 去識別化服務失敗

- **WHEN** 租戶開啟 AI 個資遮罩，去識別化服務回 503，客人在 `BOT_HANDLED` 對話傳送「1+1等於幾」，agent 與知識庫自動回覆都因此失敗
- **THEN** 對話為 `AGENT_HANDLED`，`handoffReason` 為「AI 暫時無法回覆（去識別化服務無法使用）」，對話有一則系統訊息、沒有機器人回覆，系統發出一個 `conversation.handoff`，客人收到一則渠道的轉接訊息

#### Scenario: 其他錯誤

- **WHEN** 未開啟 AI 個資遮罩，agent 的模型供應商丟錯，知識庫的 embedding 服務回 500
- **THEN** 對話為 `AGENT_HANDLED`，`handoffReason` 為「AI 暫時無法回覆（AI 服務發生錯誤）」，`handoffReason` 與系統訊息不含 embedding 服務的錯誤內容

#### Scenario: agent 失敗但知識庫回覆成功

- **WHEN** agent 的模型供應商丟錯，知識庫自動回覆找到文章並送出回覆
- **THEN** 客人收到知識庫的回覆，對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`

### Requirement: 正常不回覆時不轉接

agent 與知識庫自動回覆因下列原因沒有回覆時，不是失敗，系統 SHALL NOT 因此轉接：能在該渠道回覆的關鍵字規則命中、渠道的 `botMode` 為 `off` 或 `keyword`、知識庫自動回覆停用、這則訊息已有機器人回覆、對話已不是 `BOT_HANDLED`。

#### Scenario: 關鍵字規則讓步

- **WHEN** 去識別化服務無法使用，客人傳送命中 `send_message` 關鍵字規則的文字「營業時間」
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`，客人沒有收到轉接訊息

#### Scenario: botMode 關閉

- **WHEN** 渠道的 `botMode` 為 `off`，去識別化服務無法使用，客人傳送文字
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`

#### Scenario: 知識庫自動回覆停用

- **WHEN** `KB_AUTO_REPLY_ENABLED` 為 false，agent 因去識別化服務無法使用而失敗
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`

#### Scenario: 這則訊息已有機器人回覆

- **WHEN** 這則入站訊息已有 `bot_reply` 認領紀錄，`message.received` 再被處理一次，去識別化服務無法使用
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`，客人沒有收到轉接訊息

### Requirement: AI 失敗的轉接每則訊息最多一次

AI 失敗的轉接 SHALL 以「`bot_reply` + 入站訊息 id」認領，認領與轉接寫在同一個交易。轉接的交易失敗時，處理 SHALL 失敗，由佇列重試；commit 之後送出轉接訊息失敗 SHALL 只記錄，不重試。系統 SHALL NOT 自動重新送出 AI 回覆。

#### Scenario: 同一則訊息處理兩次

- **WHEN** agent 與知識庫都失敗的 `message.received` 被處理兩次
- **THEN** 對話只有一則轉接系統訊息，系統只發出一個 `conversation.handoff`，客人只收到一則轉接訊息

#### Scenario: 寫入系統訊息失敗

- **WHEN** agent 與知識庫都失敗，轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 處理失敗，對話仍是 `BOT_HANDLED`，沒有 `conversation.handoff`，客人沒有收到轉接訊息；佇列重試時轉接一次
