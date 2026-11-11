## ADDED Requirements

### Requirement: 無法解析的訊息顯示佔位文字
訊息的 `content` 是物件、但沒有 `text` 時，收件匣的訊息泡泡 SHALL 顯示「[不支援的訊息類型]」，SHALL NOT 顯示 `[object Object]`。

#### Scenario: 無法解析的訊息
- **WHEN** 收件匣顯示一則 `contentType` 為 `unknown`、`content` 為 `{}` 的訊息
- **THEN** 訊息泡泡顯示「[不支援的訊息類型]」
