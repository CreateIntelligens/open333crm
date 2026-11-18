## ADDED Requirements

### Requirement: 客人只能替已解決的工單評分

客人回覆滿意度分數時（LINE 問卷按鈕的 postback，或客人傳來的 `csat:<分數>:<工單 ID>`），系統 SHALL 只在工單狀態是 `RESOLVED` 時記錄。工單是其他狀態（例如重新開啟後的 `OPEN`、`IN_PROGRESS`，或已逾時結案的 `CLOSED`）時，系統 SHALL NOT 寫入分數，SHALL NOT 送感謝訊息，SHALL NOT 發低分通知，SHALL NOT 改變工單與對話的狀態。系統 SHALL 以條件更新判斷狀態，讀取之後工單才被重開時同樣不寫入。客服代評不受這條規則限制。

#### Scenario: 工單重開後客人點舊問卷

- **WHEN** 工單寄過問卷後被改成 `IN_PROGRESS`，客人回覆 2 分
- **THEN** 系統回傳未記錄，工單狀態仍是 `IN_PROGRESS`、`csatScore` 是空值，對話沒有新訊息、狀態不變，沒有低分通知

#### Scenario: 逾時結案後客人點舊問卷

- **WHEN** 工單已因問卷逾時改成 `CLOSED`，客人回覆 5 分
- **THEN** 系統回傳未記錄，`csatScore` 是空值，對話沒有新訊息

#### Scenario: 客服代評不限工單狀態

- **WHEN** 客服以 `POST /cases/:id/csat` 替一張狀態是 `IN_PROGRESS` 的工單評 4 分
- **THEN** 系統記錄分數，`csatRatedBy` 是 `agent`
