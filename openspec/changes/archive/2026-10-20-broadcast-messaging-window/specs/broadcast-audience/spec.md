## ADDED Requirements

### Requirement: 有訊息視窗的渠道只發給視窗內互動過的人

渠道 plugin 宣告 `messagingWindowHours` 時，群發 MUST 只送給在發送當下往前 `messagingWindowHours` 小時內，在該渠道有顧客傳入訊息（`direction=INBOUND`、`senderType=CONTACT`）的聯絡人。FB 與 THREADS 的 plugin MUST 宣告 24。其他人 MUST NOT 送出，也 MUST NOT 建立收件紀錄；人數 MUST 寫入 `skippedCount`。`totalCount` 仍是符合條件的人數。符合條件的人全部在視窗外時，群發 MUST 標成 `failed`，`failureReason` MUST 寫出略過人數與視窗小時數。沒有宣告視窗的渠道 MUST 照原本方式送給全部符合條件的人，`skippedCount` 是 0。

#### Scenario: FB 群發略過超過 24 小時沒互動的人

- **WHEN** FB 渠道的群發符合條件 3 人，其中 contact-0 在 2 小時前傳過訊息，contact-1 在 30 小時前傳過訊息，contact-2 從沒傳過訊息
- **THEN** 只送給 contact-0
- **AND** 群發的 `totalCount` 是 3、`successCount` 是 1、`skippedCount` 是 2，狀態是 `completed`
- **AND** 只有 contact-0 有收件紀錄

#### Scenario: 全部在視窗外時群發失敗

- **WHEN** FB 渠道的群發符合條件 2 人，兩人都超過 24 小時沒有傳訊息
- **THEN** 不送出任何訊息，群發狀態是 `failed`、`skippedCount` 是 2
- **AND** `failureReason` 包含「2 位」與「24 小時」

#### Scenario: 沒有訊息視窗的渠道不略過

- **WHEN** LINE 渠道的群發符合條件 2 人，兩人都超過 24 小時沒有傳訊息
- **THEN** 兩人都送出，`skippedCount` 是 0

#### Scenario: FB 與 IG 的 plugin 宣告 24 小時視窗

- **WHEN** 取得 `FB` 與 `THREADS` 的 channel plugin
- **THEN** 兩者的 `messagingWindowHours` 都是 24
- **AND** `LINE` 的 plugin 沒有 `messagingWindowHours`

### Requirement: 建立群發前可以看到可送達人數

`POST /marketing/broadcasts/audience-preview` MUST 接受 `channelId`、`targetType`、`segmentId`、`targetConfig`，用和實際發送相同的受眾解析與視窗規則，回傳 `{ matched, reachable, messagingWindowHours }`，不建立群發。`messagingWindowHours` 在渠道沒有視窗時是 `null`。渠道不屬於該租戶或已停用時 MUST 回 404；受眾設定不完整時 MUST 回和建立群發相同的 400 `INVALID_AUDIENCE`。建立群發的表單 MUST 在選好渠道與受眾後顯示符合條件人數；有視窗時 MUST 一併顯示可送達人數與視窗說明。群發列表 MUST 在 `skippedCount` 大於 0 時顯示略過人數。

#### Scenario: 預估 FB 群發的可送達人數

- **WHEN** 對 FB 渠道、`targetType="all"` 呼叫 audience-preview，渠道有 3 位聯絡人，其中 1 位在 24 小時內傳過訊息
- **THEN** 回傳 `{ matched: 3, reachable: 1, messagingWindowHours: 24 }`

#### Scenario: 預估 LINE 群發

- **WHEN** 對 LINE 渠道呼叫 audience-preview，符合條件 2 人
- **THEN** 回傳 `{ matched: 2, reachable: 2, messagingWindowHours: null }`

#### Scenario: 受眾設定不完整

- **WHEN** 呼叫 audience-preview 時 `targetType="tags"` 但沒有 `tagIds`
- **THEN** 回 400 `INVALID_AUDIENCE`

#### Scenario: 表單顯示可送達人數

- **WHEN** 使用者在建立群發的表單選了 FB 渠道與受眾，預估回傳 `{ matched: 3, reachable: 1, messagingWindowHours: 24 }`
- **THEN** 表單顯示「符合條件 3 人，可送達 1 人」與「只能發給 24 小時內傳過訊息的人」的說明

#### Scenario: 列表顯示略過人數

- **WHEN** 群發的 `skippedCount` 是 2
- **THEN** 群發列表顯示「略過 2」
