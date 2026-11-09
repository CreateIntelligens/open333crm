## MODIFIED Requirements

### Requirement: 每張工單最多寄出一份滿意度問卷

寄送滿意度問卷的排程 SHALL 在寄出問卷之前認領工單：只有工單屬於該租戶、狀態是 `RESOLVED`、而且還沒有寄出時間（`csatSentAt`），系統才寫入寄出時間並寄出問卷。認領失敗時，系統 SHALL NOT 在對話中建立問卷訊息，SHALL NOT 把問卷送到客人的渠道。排程的 job 重跑、兩期重疊，或排程讀取之後工單被修改時，這條規則都成立。認領之後，寄送 SHALL 最多執行一次：建立問卷訊息、送到渠道等任何一步失敗，或行程中途結束，系統 SHALL NOT 還原寄出時間，也 SHALL NOT 再寄出這份問卷。

#### Scenario: 工單到了寄送時間，寄出一份問卷

- **WHEN** 寄送滿意度問卷的排程處理一張狀態是 `RESOLVED`、沒有 `csatSentAt`、有對話的工單
- **THEN** 系統寫入這張工單的 `csatSentAt`，在對話中建立一則問卷訊息，並把問卷送到客人的渠道

#### Scenario: 排程讀取之後，別次執行已經寄出問卷

- **WHEN** 排程讀到一張沒有 `csatSentAt` 的工單，但在認領之前，另一次執行已經寫入這張工單的 `csatSentAt`
- **THEN** 系統不在對話中建立問卷訊息，也不把問卷送到客人的渠道

#### Scenario: 排程讀取之後，客服重開了工單

- **WHEN** 排程讀到一張狀態是 `RESOLVED` 的工單，但在認領之前，客服把工單改成 `IN_PROGRESS`
- **THEN** 系統不寄出問卷，這張工單的 `csatSentAt` 維持空值

#### Scenario: 認領之後建立問卷訊息失敗

- **WHEN** 排程認領了一張工單，但在對話中建立問卷訊息時發生錯誤
- **THEN** 系統不把問卷送到客人的渠道，這張工單的 `csatSentAt` 維持認領時寫入的值，之後的執行不再寄出這份問卷

#### Scenario: 送到客人的渠道失敗

- **WHEN** 排程認領了一張工單並在對話中建立問卷訊息，但送到客人的渠道時發生錯誤
- **THEN** 對話中保留這則問卷訊息，並依「問卷送不出時客服看得到」留下送出失敗的紀錄；`csatSentAt` 維持認領時寫入的值，之後的執行不再寄出這份問卷

## ADDED Requirements

### Requirement: 問卷送不出時客服看得到

認領工單並建立問卷訊息之後，問卷沒有送到客人時，系統 SHALL 留下客服看得到的紀錄，不可只寫 log。沒有送到包括：渠道停用、找不到客人在該渠道的帳號、渠道外掛回報失敗、送出時發生錯誤。系統 SHALL 在問卷訊息的 `metadata` 寫入 `deliveryFailed: true` 與 `deliveryError`（原因），再推送一次 `message.new`；SHALL 在工單時間軸寫入一筆 `eventType` 為 `csat_send_failed`、`actorType` 為 `system`、`payload.reason` 為原因的事件。收件匣的問卷卡片 SHALL 顯示這份問卷沒有送出與原因。

#### Scenario: 問卷送出失敗時客服看得到：LINE 拒收

- **WHEN** 系統把問卷送到 LINE 客人，LINE API 回 400
- **THEN** 問卷訊息的 `metadata.deliveryFailed` 是 `true`，`deliveryError` 含 LINE 回報的狀態碼，工單多一筆 `csat_send_failed` 事件，系統再推一次帶有 `deliveryFailed` 的 `message.new`，`csatSentAt` 不被還原

#### Scenario: 問卷送出失敗時客服看得到：找不到客人的 LINE 帳號

- **WHEN** 系統寄送 LINE 對話的問卷，但聯絡人在這個渠道沒有帳號
- **THEN** 系統不呼叫 LINE，問卷訊息標示沒有送出，原因說明找不到帳號，工單多一筆 `csat_send_failed` 事件

#### Scenario: 問卷送出失敗時客服看得到：其他渠道送不出

- **WHEN** 系統寄送非 LINE 對話的問卷，渠道送出回報失敗
- **THEN** 問卷訊息標示沒有送出，工單多一筆 `csat_send_failed` 事件

#### Scenario: 問卷送出失敗時客服看得到：卡片顯示沒有送出與原因

- **WHEN** 收件匣顯示一則 `metadata.deliveryFailed` 為 `true` 的問卷訊息
- **THEN** 問卷卡片顯示「這份問卷沒有送出，客人並未收到」與 `deliveryError`；沒有失敗的問卷卡片不顯示這段提示

### Requirement: LINE 客人收到 Flex 問卷

系統寄給 LINE 客人的滿意度問卷 SHALL 是一則 Flex message：有替代文字（`altText`），五個分數按鈕的 postback 資料是 `csat:<分數>:<工單 ID>`。

#### Scenario: LINE 客人收到的問卷是 Flex 訊息

- **WHEN** 系統寄送 LINE 對話的問卷，LINE API 接受請求
- **THEN** 送給 LINE 的第一則訊息 `type` 是 `flex`、`altText` 不是空字串，按鈕的 postback 資料依序是 `csat:1:<工單 ID>` 到 `csat:5:<工單 ID>`，系統不寫入送出失敗的紀錄
