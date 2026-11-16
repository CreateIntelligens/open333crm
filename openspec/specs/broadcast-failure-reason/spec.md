# broadcast-failure-reason Specification

## Purpose
規定廣播發送失敗時要把中文原因記錄在廣播上並顯示在後台，讓排程發送的失敗也看得到為什麼；失敗的廣播可以重新發送（清掉舊原因）或取消，非預期錯誤只顯示通用說明、不外露內部錯誤。

## Requirements

### Requirement: Broadcast Failure Reason Is Recorded
When a broadcast send by a user or by the scheduler ends in `failed`, the system SHALL store a reason in Chinese in the `failureReason` field of the broadcast. An `AppError` SHALL give its message as the reason. Any other error SHALL give a general Chinese reason without the internal error text. When at least one recipient succeeds, `failureReason` SHALL be null.

#### Scenario: Scheduled broadcast with an empty audience
- **WHEN** the scheduler sends a broadcast whose tag audience resolves to no channel identity
- **THEN** the broadcast SHALL be `failed` and `failureReason` SHALL be the Chinese message of the `BROADCAST_NO_RECIPIENTS` error

#### Scenario: Unexpected error during a send
- **WHEN** a send throws an error that is not an `AppError`
- **THEN** the broadcast SHALL be `failed` and `failureReason` SHALL be a general Chinese message that does not contain the error text

#### Scenario: Every recipient fails
- **WHEN** the channel returns an error for every recipient of a broadcast
- **THEN** the broadcast SHALL be `failed` and `failureReason` SHALL contain the number of failed recipients and the first channel error

#### Scenario: Some recipients fail
- **WHEN** at least one recipient succeeds and at least one recipient fails
- **THEN** the broadcast SHALL be `completed` and `failureReason` SHALL be null

### Requirement: Failure Reason Is Cleared When A Broadcast Is Sent Again
When a send starts, the system SHALL set `failureReason` to null in the same update that sets the status to `sending`.

#### Scenario: Resend a failed broadcast successfully
- **WHEN** a broadcast with a `failureReason` is sent again and a recipient succeeds
- **THEN** the broadcast SHALL be `completed` and `failureReason` SHALL be null

### Requirement: Failed Broadcasts Show The Reason And Can Be Resent Or Cancelled
The broadcast list and the broadcast table of a campaign SHALL show the `failureReason` of each `failed` broadcast next to its status. When a `failed` broadcast has no `failureReason`, the list SHALL say that no reason was recorded. The broadcast list SHALL show a resend button and a cancel button for each `failed` broadcast.

#### Scenario: Failed broadcast in the list
- **WHEN** the broadcast list shows a `failed` broadcast with a `failureReason`
- **THEN** the reason SHALL be visible in the row and a resend button SHALL be shown

#### Scenario: Old failed broadcast without a reason
- **WHEN** the broadcast list shows a `failed` broadcast whose `failureReason` is null
- **THEN** the row SHALL say that no reason was recorded

#### Scenario: Cancel a failed broadcast
- **WHEN** a user presses the cancel button of a `failed` broadcast and confirms
- **THEN** the system SHALL call the cancel API for that broadcast

### Requirement: 一般群發記錄每位收件人的失敗原因
一般群發的收件人送不出時，收件紀錄 SHALL 為 `deliveryStatus = failed`、`skipReason = DELIVERY_FAILED`；送達的收件紀錄 `skipReason` SHALL 為 null。LINE multicast 一批失敗時，該批每位收件人 SHALL 都寫這個原因。重新發送時，既有收件紀錄的狀態與原因 SHALL 依這次的結果更新。`GET /marketing/broadcasts/:id/recipients?status=failed` SHALL 列出一般群發失敗的收件人與原因。

#### Scenario: 逐人送出時一位收件人失敗
- **GIVEN** 一般群發要送甲、乙，渠道拒收給乙的訊息
- **WHEN** 群發發送
- **THEN** 甲的收件紀錄為 `sent`、原因 null；乙為 `failed`、原因 `DELIVERY_FAILED`
- **AND** 廣播為 `completed`，`GET /recipients?status=failed` 只列出乙與原因 `DELIVERY_FAILED`

#### Scenario: multicast 整批失敗
- **WHEN** LINE 無變數的一般群發以 multicast 送出，渠道拒絕這一批
- **THEN** 這一批每位收件人的收件紀錄都是 `failed`、原因 `DELIVERY_FAILED`

#### Scenario: 重新發送後成功
- **GIVEN** 乙上次的收件紀錄是 `failed`、原因 `DELIVERY_FAILED`
- **WHEN** 群發重新發送，這次送達乙
- **THEN** 乙的收件紀錄改為 `sent`、原因 null

### Requirement: 所有廣播都可以查看收件人結果
廣播列表 SHALL 對每一則 `completed`、`failed` 或 `sending` 的廣播顯示結果按鈕，附券與一般群發都有。一般群發的結果 SHALL 顯示成功、失敗與略過人數，並列出失敗的收件人與中文原因。

#### Scenario: 一般群發的結果按鈕
- **WHEN** 廣播列表有一則已完成的一般群發
- **THEN** 那一列有「發送結果」按鈕

#### Scenario: 一般群發的結果列出失敗的人
- **WHEN** 管理者打開一則一般群發的結果，`GET /recipients?status=failed` 回傳乙、原因 `DELIVERY_FAILED`
- **THEN** 結果顯示成功與失敗人數，並列出乙與「訊息送不出（顧客可能已封鎖）」
