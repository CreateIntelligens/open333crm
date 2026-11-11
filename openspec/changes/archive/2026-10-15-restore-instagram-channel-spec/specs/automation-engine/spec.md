## ADDED Requirements

### Requirement: 非文字訊息不做 AI 自動回覆
收到 `message.received` 時，系統 SHALL 只對文字訊息執行 AI 自動回覆（Agent 與 KB 自動回覆）。`contentType` 不是 `text` 的訊息 SHALL NOT 觸發 AI 自動回覆，即使訊息帶有文字，例如 Instagram 的愛心是 `content.text` 為「❤️」的貼圖。事件沒有 `contentType` 時視為文字訊息。

機器人處理中的對話收到圖片、檔案或影片時，系統 SHALL 把對話轉給真人。

#### Scenario: 客人傳帶文字的貼圖
- **WHEN** 機器人處理中的對話收到 `contentType` 為 `sticker`、`content.text` 為「❤️」的訊息
- **THEN** 系統不執行 AI 自動回覆

#### Scenario: 客人傳圖片
- **WHEN** 機器人處理中的對話收到 `contentType` 為 `image` 的訊息
- **THEN** 系統把對話轉給真人，不執行 AI 自動回覆

#### Scenario: 客人傳文字
- **WHEN** 機器人處理中的對話收到 `contentType` 為 `text` 的訊息
- **THEN** 系統執行 AI 自動回覆
