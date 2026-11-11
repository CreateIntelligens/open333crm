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

型號守門的回覆（`model_not_found`）SHALL 與追問共用追問次數，每則守門回覆加 1。命中型號守門時追問次數已達 `clarifyMaxAttempts`，系統 SHALL NOT 送出型號引導，SHALL 改走上述追問用完的轉接。

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

#### Scenario: 型號守門回覆累加追問次數
- **WHEN** 租戶型號白名單有 `TAC-11A`，`clarifyMaxAttempts` 為 2，對話的追問次數為 0，客人傳送「TAC-11P 怎麼清洗」且知識庫相似度低於 0.85
- **THEN** 機器人回覆類型為 `model_not_found`，追問次數變成 1，對話仍是 `BOT_HANDLED`

#### Scenario: 型號守門時追問次數已用完
- **WHEN** 租戶型號白名單有 `TAC-11A`，`clarifyMaxAttempts` 為 2，對話的追問次數為 2，客人傳送「TAC-11P 怎麼清洗」且知識庫相似度低於 0.85
- **THEN** 系統不呼叫 LLM，客人收到「已為您轉接客服人員」，回覆類型為 `clarify_handoff`，對話為 `AGENT_HANDLED`、`handoffReason` 說明追問次數已達上限，系統發出一個 `conversation.handoff`，追問次數為 0

#### Scenario: 客人一直提到查無的型號
- **WHEN** 租戶型號白名單有 `TAC-11A`，`clarifyMaxAttempts` 為 2，對話的追問次數為 0，客人連續傳送三則提到 `TAC-11P` 的訊息，知識庫相似度都低於 0.85
- **THEN** 前兩則的回覆類型為 `model_not_found`，第三則為 `clarify_handoff`，對話為 `AGENT_HANDLED`

### Requirement: 轉接後關鍵字規則照常回覆

命中能在該渠道回覆的 `keyword.matched` 規則的訊息，知識庫自動回覆 SHALL 讓步，這則訊息不算追問，也不觸發追問用完的轉接。對話轉接成 `AGENT_HANDLED` 之後，系統 SHALL 照常以這則訊息評估關鍵字規則並執行其動作；知識庫自動回覆與 agent 回覆 SHALL NOT 回覆 `AGENT_HANDLED` 的對話。知識庫自動回覆 SHALL 在寫入回覆的交易內，以條件更新確認對話仍是 `BOT_HANDLED`；條件不成立時，系統 SHALL NOT 寫入或送出這則回覆。

#### Scenario: 轉接後客人傳送關鍵字
- **WHEN** 對話因追問用完轉接成 `AGENT_HANDLED` 之後，客人傳送文字「營業時間」
- **THEN** 系統以「營業時間」送出這則訊息的關鍵字規則評估，知識庫自動回覆不再回覆

#### Scenario: 知識庫產生回覆期間客服接手
- **WHEN** 知識庫自動回覆已經確認對話是 `BOT_HANDLED`，在 LLM 回應之前，客服接手對話，對話改成 `AGENT_HANDLED`
- **THEN** 對話沒有這次的機器人回覆訊息，客人沒有收到回覆，對話的 `botRepliesCount` 不變

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

AI 失敗的轉接 SHALL 以「`bot_reply` + 入站訊息 id」認領，認領與轉接寫在同一個交易。轉接的交易失敗時，處理 SHALL 失敗，由佇列重試；commit 之後送出轉接訊息失敗 SHALL 只記錄，不重試。系統 SHALL NOT 在轉接或回覆送出之後再為同一則訊息呼叫 AI 補送回覆。轉接的交易失敗時還沒有任何回覆或轉接送出，佇列重試會重新處理這則訊息：AI 或知識庫這次成功就送出回覆、不轉接，仍失敗才轉接，客人只會收到其中一種。

#### Scenario: 同一則訊息處理兩次

- **WHEN** agent 與知識庫都失敗的 `message.received` 被處理兩次
- **THEN** 對話只有一則轉接系統訊息，系統只發出一個 `conversation.handoff`，客人只收到一則轉接訊息

#### Scenario: 寫入系統訊息失敗

- **WHEN** agent 與知識庫都失敗，轉接的交易在寫入系統訊息時丟出錯誤
- **THEN** 處理失敗，對話仍是 `BOT_HANDLED`，沒有 `conversation.handoff`，客人沒有收到轉接訊息；佇列重試時重新處理這則訊息，AI 與知識庫仍失敗時轉接一次

### Requirement: 型號守門只攔截知識庫型號格式的型號

型號偵測 SHALL 不分大小寫，結果一律轉成大寫：型號是 1 到 4 個英文字母的前綴、`-`、再接英數段（例如 `TAC-11P`、`TAC-06L-MCW`），`tac-11p` 與 `TAC-11P` 視為同一個型號。轉成大寫後是常見英文詞的（`WI-FI`、`E-MAIL`、`T-SHIRT`、`USB-C`、`TYPE-C`、`HDMI-2`、`CD-R`、`DVD-R`）SHALL NOT 當成型號；從文章標題抽出型號白名單時套用同一規則。型號守門 SHALL 只攔截前綴出現在租戶型號白名單的型號；白名單是空的（知識庫沒有型號文章）時 SHALL NOT 攔截任何訊息。

#### Scenario: 一般英文詞不當成型號
- **WHEN** 租戶型號白名單有 `TAC-11A`，客人傳送「我家 Wi-Fi 連不上怎麼辦」「請問可以寄 e-mail 給你們嗎」「我想買 T-shirt」「WI-FI 密碼要怎麼改」或「wi-fi 一直斷線」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`（照常追問），回覆的 metadata 沒有 `modelGuard`

#### Scenario: 小寫型號視同大寫
- **WHEN** 租戶型號白名單有 `TAC-11A`、`TAC-11KN`，客人傳送「tac-11p 怎麼清洗」，知識庫相似度低於 0.85
- **THEN** 回覆類型為 `model_not_found`，`modelGuard.unknownModel` 為 `TAC-11P`；客人傳送「tac-11a 怎麼清洗」時回覆類型不是 `model_not_found`

#### Scenario: 查無的型號仍引導選型號
- **WHEN** 租戶型號白名單有 `TAC-11A`、`TAC-11KN`，客人傳送「TAC-11P 怎麼清洗」，知識庫相似度低於 0.85
- **THEN** 回覆類型為 `model_not_found`，`modelGuard.unknownModel` 為 `TAC-11P`，`modelGuard.relatedModels` 為 `TAC-11A`、`TAC-11KN`

#### Scenario: 知識庫沒有型號文章時不守門
- **WHEN** 租戶型號白名單是空的，客人傳送「TAC-11P 怎麼清洗」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`，回覆的 metadata 沒有 `modelGuard`

#### Scenario: 前綴不在白名單的編號不守門
- **WHEN** 租戶型號白名單只有 `TAC` 前綴的型號，客人傳送「我的訂單 AB-12345 還沒到」，知識庫相似度低於 0.85
- **THEN** 回覆類型不是 `model_not_found`

#### Scenario: 型號偵測不命中一般英文詞
- **WHEN** 以 `Wi-Fi`、`wi-fi`、`e-mail`、`T-shirt`、`WI-FI`、`E-MAIL`、`T-SHIRT`、`USB-C`、`Type-C`、`HDMI-2` 呼叫型號偵測
- **THEN** 偵測結果是空的；以 `TAC-11P`、`TAC-06L-MCW`、`TAW-A080WM`、`TDH-168MC-NW`、`AC-9` 呼叫時各偵測到一個型號，以 `tac-11p` 呼叫時偵測到 `TAC-11P`

### Requirement: 未遮罩的進站訊息不交給 AI，轉接真人

`message.received` 的 `payload.privacyUnmasked` 是 `true`、對話是 `BOT_HANDLED`、訊息是文字，而且這則訊息原本會交給 agent 或知識庫自動回覆時，系統 SHALL NOT 呼叫 agent、知識庫自動回覆或 embedding，SHALL 以 `bot_reply` 認領後轉接真人：對話改成 `AGENT_HANDLED`，`handoffReason` 是「去識別化服務無法使用，這則訊息未遮罩、未交給 AI」，寫入一則不呼叫去識別化服務的系統訊息（`metadata.source` 是 `inbound_unmasked`），發出 `conversation.handoff`，commit 之後送出渠道的轉接訊息。情緒分析 SHALL 只用關鍵字判斷，不呼叫模型。「正常不回覆時不轉接」列出的情況 SHALL NOT 轉接。

#### Scenario: 未遮罩的訊息轉接真人

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人在 `BOT_HANDLED` 對話傳送「我的電話 0912345678」，系統處理這則訊息的 `message.received`
- **THEN** 對話是 `AGENT_HANDLED`，`handoffReason` 是「去識別化服務無法使用，這則訊息未遮罩、未交給 AI」，對話有一則 `metadata.source` 為 `inbound_unmasked` 的系統訊息，沒有機器人回覆，系統發出一個 `conversation.handoff`，客人收到一則轉接訊息，模型供應商與 embedding 服務都沒有被呼叫

#### Scenario: 未遮罩的訊息命中關鍵字規則

- **WHEN** `payload.privacyUnmasked` 是 `true`，客人傳送命中 `send_message` 關鍵字規則的文字
- **THEN** 對話仍是 `BOT_HANDLED`，系統沒有發出 `conversation.handoff`，模型供應商沒有被呼叫

#### Scenario: 未遮罩的訊息的情緒分析

- **WHEN** `payload.privacyUnmasked` 是 `true`，客人傳送「太爛了」
- **THEN** 這則訊息的 `metadata.sentiment.sentiment` 是 `negative`，模型供應商沒有被呼叫

### Requirement: 模型讀取的對話紀錄略過未遮罩的訊息

模型讀取訊息內容的函式 SHALL 略過 `metadata.privacy.mode` 為 `inbound_unmasked` 的訊息，包括 AI 建議回覆、對話摘要、agent 與知識庫自動回覆的歷史、其他渠道脈絡與新工單的自動分類。

#### Scenario: 對話紀錄有未遮罩的訊息

- **WHEN** 對話紀錄有一則 `metadata.privacy.mode` 為 `inbound_unmasked`、內容是「我的電話 0912345678」的進站訊息，以及一則有遮罩副本的進站訊息
- **THEN** 模型讀到的歷史只有遮罩副本那一則，不含「0912345678」

#### Scenario: 新工單最新的進站訊息未遮罩

- **WHEN** 新工單所屬對話最新的進站訊息是未遮罩的訊息
- **THEN** 系統不呼叫模型分類，工單的分類仍是空的

### Requirement: 程式固定的系統文字不呼叫去識別化服務

租戶開啟 AI 個資遮罩時，程式內固定、不含顧客輸入或名稱的系統訊息 SHALL 原文送出與保存，遮罩副本 SHALL 就是原文（`metadata.privacy.mode` 為 `system_fixed`），SHALL NOT 呼叫去識別化服務。這類訊息是：按鈕轉接人工的系統訊息、跨渠道綁定失敗的內部提示、滿意度調查、評分後的固定回覆、座席轉接時沒有填寫的預設轉接訊息。含顧客名稱的綁定訊息與含座席名稱的交回 Bot 訊息 SHALL 維持原本的遮罩方式。

#### Scenario: 去識別化服務無法使用時客人點按轉接人工

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人在 `BOT_HANDLED` 對話點按 `handoff_request` 按鈕
- **THEN** 對話是 `AGENT_HANDLED`，有一則內容為「使用者主動點按按鈕轉接人工客服」的系統訊息，`metadata.privacy.mode` 是 `system_fixed`，遮罩副本與內容相同

#### Scenario: 去識別化服務無法使用時滿意度調查照常送出

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，系統送出一張工單的滿意度調查
- **THEN** 問卷照常送出，對話有一則內容為「滿意度調查」的訊息，`metadata.privacy.mode` 是 `system_fixed`，遮罩副本與內容相同，系統沒有呼叫去識別化服務

#### Scenario: 去識別化服務無法使用時跨渠道綁定失敗

- **WHEN** 租戶開啟遮罩與跨渠道綁定，去識別化服務一直回 503，客人傳送「綁定帳號」
- **THEN** 綁定訊息沒有送出，對話有一則內容為「跨渠道綁定處理失敗，顧客的綁定請求沒有完成，請協助確認。」的內部提示，`metadata.privacy.mode` 是 `system_fixed`

#### Scenario: 座席轉接時沒有填寫轉接訊息

- **WHEN** 租戶開啟遮罩，座席轉接對話時沒有填寫轉接訊息
- **THEN** 系統訊息是「稍等，正在為您轉接客服人員」，遮罩副本與內容相同，系統沒有呼叫去識別化服務

### Requirement: 去識別化服務無法使用時自動轉接照常完成

租戶開啟 AI 個資遮罩，`message.received` 觸發自動轉接（轉接關鍵字、回覆次數上限或客人傳送圖片、檔案、影片），而去識別化服務在重試之後仍無法遮罩轉接的系統訊息時，系統 SHALL 照常轉接：捨棄對話摘要，系統訊息只寫「自動轉接人工客服：」加上轉接原因，以不呼叫去識別化服務的固定文字寫入（`metadata.privacy.mode` 為 `system_fixed`）。處理 SHALL NOT 因此失敗。

#### Scenario: 去識別化服務無法使用時客人要求轉接真人

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，渠道的轉接關鍵字有「真人」，客人在 `BOT_HANDLED` 對話傳送「我要找真人 0912345678」
- **THEN** 處理沒有失敗，對話是 `AGENT_HANDLED`，`handoffReason` 是「客戶要求轉接真人 (關鍵字: 真人)」，對話有一則內容為「自動轉接人工客服：客戶要求轉接真人 (關鍵字: 真人)」的系統訊息，`metadata.privacy.mode` 是 `system_fixed`，系統訊息不含「0912345678」，系統發出一個 `conversation.handoff`

### Requirement: 知識庫自動回覆不在交易內等待外部呼叫

知識庫自動回覆 MUST NOT 在資料庫交易內呼叫 embedding 服務、LLM 或去識別化服務。讀取與寫入 SHALL 在綁定這個租戶的交易內執行，受 RLS 約束。

#### Scenario: 呼叫外部服務之前交易已經結束
- **WHEN** 知識庫自動回覆向量化客人的訊息、呼叫 LLM 產生回覆，並遮罩回覆
- **THEN** 每次呼叫開始之前，知識庫自動回覆開過的交易都已經結束

#### Scenario: 對話屬於其他租戶
- **WHEN** 以租戶 A 執行知識庫自動回覆，對話 id 是租戶 B 的 `BOT_HANDLED` 對話
- **THEN** 結果是略過（`not_bot_handled`），租戶 B 的對話沒有新的訊息
