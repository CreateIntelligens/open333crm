## MODIFIED Requirements

### Requirement: A Broadcast Is Sent Once At A Time
The system SHALL accept a send of a broadcast only from status `draft`, `scheduled` or `failed`. A send job or the scheduler SHALL change a `scheduled` broadcast whose `scheduledAt` has passed to `sending` with one conditional update, and only the run whose update changes a row SHALL send messages. When a user sends a broadcast that is `sending`, the system SHALL respond 409 with code `BROADCAST_ALREADY_SENDING` and SHALL queue nothing and send no message. The send button in the web console SHALL be disabled while its request runs.

#### Scenario: Send a broadcast that is sending
- **WHEN** a user sends a broadcast whose status is `sending`
- **THEN** the system SHALL respond 409 with code `BROADCAST_ALREADY_SENDING`, no send job SHALL be queued and no message SHALL be sent

#### Scenario: Two send requests at the same time
- **WHEN** two requests send the same draft broadcast, and both queued send jobs and the scheduler run
- **THEN** only one run SHALL send messages and each recipient SHALL receive the message once

#### Scenario: Retry a failed broadcast
- **WHEN** a user sends a broadcast whose status is `failed` and the queued send job runs
- **THEN** the system SHALL send it again

#### Scenario: Send button while sending
- **WHEN** a user clicks the send button of a draft broadcast and the request has not finished
- **THEN** the send button of that broadcast SHALL be disabled

## ADDED Requirements

### Requirement: 立即發送的一般群發在背景執行
一般群發（沒有附券）按「立即發送」時，系統 SHALL NOT 在 HTTP 請求內發送。系統 SHALL 把廣播設為 `scheduled`、`scheduledAt` 為現在、`scheduledById` 為按下的成員，在同一個交易寫入 `coupon-broadcast` 佇列的 job，並回 202 `{ id, status: 'scheduled', scheduledAt }`。發送時的錯誤（例如受眾為空、額度不足）SHALL 寫在廣播的 `status = failed`、`failureCode` 與 `failureReason`，不是 HTTP 回應。發送失敗後 job 重試 SHALL NOT 再發送。前端收到 202 時 SHALL 說明已開始在背景發送。

#### Scenario: 立即發送一般群發回 202 並在背景送出
- **WHEN** 有 `marketing.broadcast` 的成員對一則一般群發草稿按「立即發送」
- **THEN** 回 202，`data.status` 為 `scheduled`，廣播的 `scheduledById` 是這位成員，outbox 有一筆 `coupon-broadcast` job，此時沒有送出任何訊息
- **AND** job 執行後廣播為 `completed`，收件人收到訊息

#### Scenario: 背景發送時受眾為空
- **WHEN** 立即發送一則受眾解析不到任何人的一般群發，job 執行
- **THEN** HTTP 回 202；廣播為 `failed`，`failureCode` 為 `BROADCAST_NO_RECIPIENTS`

#### Scenario: 發送失敗後 job 重試不重送
- **GIVEN** 一則一般群發已由 job 發送並標為 `failed`
- **WHEN** 同一個 job 再執行一次
- **THEN** 沒有送出任何訊息，廣播仍為 `failed`

#### Scenario: 送出網站聊天室的舊一般群發
- **GIVEN** 修正前建立、渠道為網站聊天室的一般群發草稿
- **WHEN** 管理者按下送出
- **THEN** 回 400 `CHANNEL_PUSH_NOT_SUPPORTED`，廣播標為失敗並寫入原因，沒有排入 job

### Requirement: 一般群發發送前檢查訊息額度
渠道外掛提供訊息額度查詢（`extensions.analytics.getMessageQuota`）時，一般群發 SHALL 在解析完受眾、送出第一則訊息之前查詢額度。剩餘額度（`maxMessages - totalUsage`）小於這次要送出的人數時，系統 SHALL 不送出任何訊息，廣播標為 `failed`，`failureCode = LINE_QUOTA_INSUFFICIENT`，`failureReason` 寫出剩餘額度與要送的人數。查詢失敗時 SHALL 不送出，`failureCode = LINE_QUOTA_CHECK_FAILED`。外掛沒有額度查詢、或額度沒有上限（`maxMessages` 未提供）時 SHALL 照常發送。判斷依外掛能力，不依渠道類型。

#### Scenario: 一般群發額度不足
- **GIVEN** 渠道外掛回報本月剩餘額度 1 則，一般群發要送 2 人
- **WHEN** 群發發送
- **THEN** 沒有送出任何訊息，廣播為 `failed`，`failureCode` 為 `LINE_QUOTA_INSUFFICIENT`，`failureReason` 包含剩餘 1 則與 2 人

#### Scenario: 額度查詢失敗
- **WHEN** 一般群發發送時外掛的額度查詢丟出錯誤
- **THEN** 沒有送出任何訊息，廣播為 `failed`，`failureCode` 為 `LINE_QUOTA_CHECK_FAILED`

#### Scenario: 額度足夠
- **GIVEN** 剩餘額度 10 則，一般群發要送 2 人
- **WHEN** 群發發送
- **THEN** 兩人都收到訊息，廣播為 `completed`

#### Scenario: 外掛沒有額度查詢
- **WHEN** 渠道外掛沒有 `getMessageQuota`，一般群發發送
- **THEN** 照常送出，廣播為 `completed`

### Requirement: 附券廣播在名額預估完成前不能建立
建立廣播的表單附上優惠券時，受眾預估（`POST /marketing/broadcasts/audience-preview`）還沒回應、或回應失敗，「建立」按鈕 SHALL 停用。預估失敗時表單 SHALL 顯示失敗原因與「重試」按鈕，按下 SHALL 重新預估。沒有附券的廣播不受影響。

#### Scenario: 名額預估還沒回應
- **WHEN** 管理者附上優惠券，受眾預估還在進行
- **THEN** 「建立」按鈕停用

#### Scenario: 名額預估失敗
- **WHEN** 管理者附上優惠券，受眾預估回錯誤「無法預估」
- **THEN** 「建立」按鈕停用，表單顯示錯誤原因與「重試」按鈕
- **AND** 按「重試」後重新呼叫預估，成功時「建立」按鈕可以按
