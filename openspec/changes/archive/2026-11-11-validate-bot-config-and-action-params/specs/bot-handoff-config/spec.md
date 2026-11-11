## ADDED Requirements

### Requirement: 讀取機器人設定時不合法的值改用預設值

系統讀取 `Channel.settings.botConfig` 時，型別或範圍不合法的欄位 SHALL 改用該欄位的預設值，SHALL NOT 丟出例外。`handoffKeywords` 是陣列時，系統 SHALL 只使用其中不空白的字串；不是陣列時使用預設關鍵字。`handoffMessage` 不是字串或空白時使用預設轉接訊息。自動轉接、KB 自動回覆的轉接提示與 `handoff_request` 回覆 SHALL 使用同一份讀取結果。

#### Scenario: 轉接關鍵字有空字串
- **WHEN** 渠道已存的 `handoffKeywords` 是 `['', '真人']`，客人在 `BOT_HANDLED` 對話傳送「請問營業時間」
- **THEN** 對話不轉接；客人傳送「我要真人」時對話轉接

#### Scenario: 欄位型別錯誤
- **WHEN** 渠道已存的 `handoffPromptEnabled` 是 `"false"`、`maxBotReplies` 是 `null`、`handoffKeywords` 是 `"真人,客服"`
- **THEN** 讀取結果是 `handoffPromptEnabled` 為 `true`、`maxBotReplies` 為 5、`handoffKeywords` 為預設關鍵字

#### Scenario: 轉接訊息空白
- **WHEN** 渠道已存的 `handoffMessage` 是空字串，對話自動轉接
- **THEN** 客人收到預設轉接訊息「稍等，正在為您轉接客服人員」
