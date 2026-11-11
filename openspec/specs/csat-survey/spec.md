# csat-survey Specification

## Purpose
定義滿意度問卷（CSAT）的生命週期：工單解決後，系統寄出問卷請客人評分；問卷寄出後逾時沒有回覆，系統自動結案。

## Requirements

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

### Requirement: 問卷逾時結案不覆蓋已變更的工單

問卷逾時結案的排程 SHALL 在結案之前認領工單：只有工單屬於該租戶、狀態是 `RESOLVED`、而且客人還沒有回覆（`csatRespondedAt` 是空值），系統才把工單改成 `CLOSED`。認領失敗時，系統 SHALL NOT 改變工單，SHALL NOT 發布 `case.closed`，SHALL NOT 推送 `case.updated`，SHALL NOT 關閉工單底下的對話。

#### Scenario: 問卷逾時沒有回覆，工單結案

- **WHEN** 問卷逾時結案的排程處理一張狀態是 `RESOLVED`、問卷已逾時、沒有 `csatRespondedAt` 的工單
- **THEN** 系統把工單改成 `CLOSED` 並寫入 `closedAt`，發布一次 `case.closed`，並關閉工單底下還沒關閉的對話

#### Scenario: 排程讀取之後，客服重開了工單

- **WHEN** 排程讀到一張狀態是 `RESOLVED` 的工單，但在認領之前，客服把工單改成 `IN_PROGRESS`
- **THEN** 工單維持 `IN_PROGRESS`，系統不發布 `case.closed`，也不關閉工單底下的對話

#### Scenario: 排程讀取之後，客人回覆了評分

- **WHEN** 排程讀到一張沒有 `csatRespondedAt` 的工單，但在認領之前，客人的評分已經寫入 `csatRespondedAt`
- **THEN** 問卷逾時結案的排程不改變這張工單，也不發布 `case.closed`

#### Scenario: 排程讀取之後，別次執行已經結案

- **WHEN** 排程讀到一張狀態是 `RESOLVED` 的工單，但在認領之前，另一次執行已經把工單改成 `CLOSED`
- **THEN** 這次執行不發布 `case.closed`，也不關閉工單底下的對話

### Requirement: 停用租戶不寄出滿意度問卷

寄送滿意度問卷的排程 SHALL 只處理啟用中租戶的工單。租戶停用（含試用到期自動停用）時，系統 SHALL NOT 寫入工單的 `csatSentAt`，SHALL NOT 在對話中建立問卷訊息，SHALL NOT 把問卷送到客人的渠道。

#### Scenario: 停用租戶的工單到了寄送時間

- **WHEN** 租戶已停用，寄送滿意度問卷的排程遇到該租戶一張狀態是 `RESOLVED`、沒有 `csatSentAt`、有對話、已過寄送時間的工單
- **THEN** 這張工單的 `csatSentAt` 維持空值，對話中沒有問卷訊息

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

### Requirement: 評分後收件匣的問卷卡片顯示分數

系統記錄一張工單的滿意度分數時（客人回覆或客服代評），SHALL 在這張工單的每則問卷訊息（`contentType` 是 `csat`、`metadata.caseId` 是這張工單、所在對話屬於同一租戶並連結這張工單）的 `metadata` 寫入 `csatScore`（分數）與 `csatRatedBy`（客人回覆是 `customer`，客服代評是 `agent`），保留原有的 `metadata` 欄位，並對每則更新的問卷訊息推送一次帶有新 `metadata` 的 `message.new`。收件匣的問卷卡片有分數時 SHALL 唯讀，顯示分數與評分者（「客人評 N 分」或「客服代評 N 分」）。

#### Scenario: 客人評分後問卷卡片顯示分數

- **WHEN** 工單有一則問卷訊息，客人回覆 2 分
- **THEN** 問卷訊息的 `metadata.csatScore` 是 2、`metadata.csatRatedBy` 是 `customer`、原有的 `metadata.caseId` 保留，系統推送一次 `message.new`，訊息 ID 是這則問卷訊息、`metadata.csatScore` 是 2

#### Scenario: 客服代評後問卷卡片標明客服代評

- **WHEN** 客服以 `POST /cases/:id/csat` 替一張有問卷訊息的工單評 4 分
- **THEN** 問卷訊息的 `metadata.csatScore` 是 4、`metadata.csatRatedBy` 是 `agent`

#### Scenario: 有分數的問卷卡片唯讀

- **WHEN** 收件匣顯示一則 `metadata.csatScore` 是 2、`metadata.csatRatedBy` 是 `customer` 的問卷訊息
- **THEN** 卡片顯示「客人評 2 分」，五顆星都不能點

### Requirement: 評分寫入工單時間軸

系統記錄滿意度分數時 SHALL 在工單時間軸寫入一筆 `eventType` 為 `csat_rated` 的事件，`payload.score` 是分數、`payload.source` 是 `customer` 或 `agent`；客人回覆時 `actorType` 是 `contact`，客服代評時 `actorType` 是 `agent`、`actorId` 是評分的客服。評分後系統自動關閉工單時，若工單原本不是 `CLOSED`，SHALL 再寫入一筆 `eventType` 為 `status_changed` 的事件，`actorType` 是 `system`，`payload.from` 是原狀態、`payload.to` 是 `CLOSED`、`payload.reason` 是 `csat_rated`。工單時間軸 SHALL 以中文顯示這兩筆事件，標明客人評分或客服代評；工單詳情頁 SHALL 顯示滿意度分數。

#### Scenario: 客人評分後時間軸有評分與自動關閉紀錄

- **WHEN** 狀態是 `RESOLVED` 的工單，客人回覆 2 分
- **THEN** 工單多一筆 `csat_rated` 事件（`actorType` 是 `contact`、`payload.score` 是 2、`payload.source` 是 `customer`），以及一筆 `status_changed` 事件（`actorType` 是 `system`、`from` 是 `RESOLVED`、`to` 是 `CLOSED`、`reason` 是 `csat_rated`）

#### Scenario: 客服代評的時間軸紀錄標明客服

- **WHEN** 客服替一張工單評 4 分
- **THEN** `csat_rated` 事件的 `actorType` 是 `agent`、`actorId` 是這位客服、`payload.source` 是 `agent`

#### Scenario: 時間軸以中文顯示評分與自動關閉

- **WHEN** 工單時間軸有一筆 `payload.source` 是 `customer`、`payload.score` 是 2 的 `csat_rated`，一筆 `payload.source` 是 `agent`、`payload.score` 是 4 的 `csat_rated`，以及一筆 `reason` 是 `csat_rated` 的 `status_changed`
- **THEN** 時間軸顯示「客人評分：2 分（不滿意）」、「客服代評滿意度：4 分（滿意）」與「狀態：已解決 → 已關閉（評分後自動關閉）」，不顯示 `csat_rated` 代碼

#### Scenario: 工單詳情頁顯示滿意度分數

- **WHEN** 工單詳情頁顯示一張 `csatScore` 是 2 的工單
- **THEN** 詳情頁的滿意度區塊顯示「2 分」與「不滿意」
