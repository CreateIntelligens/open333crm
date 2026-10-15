## ADDED Requirements

### Requirement: 客服把對話交回 Bot
具備 `inbox.manage` 且能完整存取該渠道的成員呼叫 `POST /conversations/:id/return-to-bot` 時，對話狀態為 `AGENT_HANDLED` 或 `ACTIVE` 的，系統 SHALL 把狀態改為 `BOT_HANDLED`、bot 回覆次數歸零、清除轉真人原因，並保留指派的客服。系統 SHALL 在對話寫入一則系統訊息，記錄是哪位成員交回 Bot；這則訊息 SHALL NOT 送給顧客。對話已結案、已經是 `BOT_HANDLED`、或渠道的 bot 模式為 `off` 時，系統 SHALL 回 400 並說明原因，不改變對話。

#### Scenario: 客服接手的對話交回 Bot
- **WHEN** 對話狀態為 `AGENT_HANDLED`、bot 回覆次數 3、轉真人原因 `manual_takeover`、指派給客服 A，成員呼叫交回 Bot
- **THEN** 對話狀態為 `BOT_HANDLED`、bot 回覆次數 0、轉真人原因為空、仍指派給客服 A，對話多一則系統訊息，渠道沒有送出任何訊息

#### Scenario: 已結案的對話
- **WHEN** 對話狀態為 `CLOSED`，成員呼叫交回 Bot
- **THEN** 回 400，說明要先重新開啟對話，狀態不變

#### Scenario: 已經是 Bot 處理
- **WHEN** 對話狀態為 `BOT_HANDLED`，成員呼叫交回 Bot
- **THEN** 回 400，狀態不變

#### Scenario: 渠道的 bot 已關閉
- **WHEN** 渠道設定的 `botConfig.botMode` 為 `off`，成員呼叫交回 Bot
- **THEN** 回 400，說明這個渠道的機器人已關閉，狀態不變

#### Scenario: 沒有管理對話的權限
- **WHEN** 只有 `inbox.view` 與 `inbox.reply` 的成員呼叫交回 Bot
- **THEN** 回傳 HTTP 403

#### Scenario: 收件匣的交回 Bot 按鈕
- **WHEN** 客服在收件匣打開狀態為 `AGENT_HANDLED` 或 `ACTIVE` 的對話並按「交回 Bot」
- **THEN** 前端呼叫 `POST /conversations/:id/return-to-bot`；狀態為 `BOT_HANDLED` 或 `CLOSED` 的對話不顯示這個按鈕
