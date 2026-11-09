## ADDED Requirements

### Requirement: 去識別化服務短暫故障時重試一次

租戶開啟 AI 個資遮罩時，系統呼叫去識別化服務遇到逾時、連線或 DNS 錯誤、HTTP 5xx，SHALL 等待約 300 毫秒後重試一次；每次嘗試的逾時 SHALL 是 6 秒。去識別化服務回 4xx、回應格式不符或回應過大時，系統 SHALL NOT 重試。

#### Scenario: 重試一次成功

- **WHEN** 租戶開啟遮罩，去識別化服務第一次回 503、第二次回正常結果，客人傳送「我的電話 0912345678」
- **THEN** 系統呼叫去識別化服務兩次，訊息照常存入，`metadata.privacy.mode` 是 `inbound`，`metadata.privacy.maskedContent` 是去識別化服務回傳的遮罩文字

#### Scenario: 去識別化服務回 400 不重試

- **WHEN** 租戶開啟遮罩，去識別化服務回 400
- **THEN** 系統只呼叫去識別化服務一次

### Requirement: 去識別化服務無法使用時進站訊息存原文並標記未遮罩

租戶開啟 AI 個資遮罩，進站訊息在重試之後仍無法遮罩時，系統 SHALL 照常存入訊息：`content` 是原文，`metadata.privacy` 是 `{ version: 1, mode: 'inbound_unmasked', reason }`，`reason` 是失敗原因代碼（`timeout`、`network`、`upstream_5xx`、`upstream_rejected`、`invalid_response`、`too_large`），沒有遮罩副本。系統 SHALL NOT 丟出例外，SHALL 照常推送 `message.new` 與 `conversation.updated`，並發布 `message.received`，`payload.privacyUnmasked` 是 `true`。

#### Scenario: 去識別化服務回 503

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人從 WebChat 傳送「我的電話 0912345678」
- **THEN** 系統呼叫去識別化服務兩次，對話有一則 `INBOUND` 訊息，`content.text` 是原文，`metadata.privacy.mode` 是 `inbound_unmasked`，`metadata.privacy.reason` 是 `upstream_5xx`，`message.received` 發布一次且 `payload.privacyUnmasked` 是 `true`

#### Scenario: 去識別化服務逾時

- **WHEN** 租戶開啟遮罩，兩次呼叫去識別化服務都逾時
- **THEN** 訊息照常存入，`metadata.privacy.reason` 是 `timeout`

#### Scenario: 去識別化服務的網址解析失敗

- **WHEN** 租戶開啟遮罩，兩次呼叫去識別化服務都因 DNS 解析失敗丟出連線錯誤
- **THEN** 訊息照常存入，`metadata.privacy.reason` 是 `network`

#### Scenario: 去識別化服務正常

- **WHEN** 租戶開啟遮罩，去識別化服務正常，客人傳送文字
- **THEN** 系統呼叫去識別化服務一次，`metadata.privacy.mode` 是 `inbound` 並帶遮罩副本，`message.received` 的 payload 沒有 `privacyUnmasked`，系統沒有發出維運告警

### Requirement: 進站訊息未遮罩時發出維運告警

進站訊息因去識別化服務無法使用而存成未遮罩時，系統 SHALL 在訊息存入之後、不在任何交易內，以合併鍵 `deidentification-unavailable` 發出維運告警（ops-alert「同一個合併鍵在 10 分鐘內只送一則」）。告警欄位 SHALL 只有租戶 ID、渠道類型與失敗原因代碼，SHALL NOT 包含訊息內容。發出告警失敗 SHALL 只記錄，SHALL NOT 影響訊息的保存與後續處理。

#### Scenario: 未遮罩的進站訊息發出告警

- **WHEN** 租戶開啟遮罩，去識別化服務一直回 503，客人傳送「我的電話 0912345678」
- **THEN** 系統以合併鍵 `deidentification-unavailable` 發出一則告警，欄位有租戶 ID 與原因 `upstream_5xx`，告警內容不含「0912345678」

#### Scenario: 發出告警失敗

- **WHEN** 去識別化服務一直回 503，發出告警時 Redis 丟出錯誤
- **THEN** 訊息照常存入並標記未遮罩，`message.received` 照常發布
