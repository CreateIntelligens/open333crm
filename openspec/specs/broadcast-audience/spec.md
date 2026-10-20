# broadcast-audience Specification

## Purpose
規定廣播受眾一定要能解析成明確的名單：沒選分群、標籤或聯絡人，分群沒有有效條件，或分群已被刪除時，一律拒絕發送，絕不退化成發給渠道全部聯絡人；同一則廣播同時只能有一個發送程序。

## Requirements

### Requirement: Broadcast Audience Selection Is Required
When a broadcast is created with `targetType` `segment`, `tags` or `contacts`, the system SHALL require a segment ID, at least one tag ID, or at least one contact ID respectively. Otherwise it SHALL respond 400 with code `INVALID_AUDIENCE` naming the missing field, and SHALL NOT create the broadcast. This applies to the REST API and MCP tools.

#### Scenario: Tags target without tags
- **WHEN** a user creates a broadcast with `targetType = tags` and no `targetConfig.tagIds`
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `targetConfig.tagIds` and no broadcast SHALL be created

#### Scenario: Contacts target without contacts
- **WHEN** a user creates a broadcast with `targetType = contacts` and an empty `targetConfig.contactIds`
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `targetConfig.contactIds`

#### Scenario: Segment target without segment
- **WHEN** a user creates a broadcast with `targetType = segment` and no `segmentId`
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `segmentId`

#### Scenario: Segment without conditions
- **WHEN** a user creates a broadcast for a segment that has no condition with a value
- **THEN** the system SHALL respond 400 with code `INVALID_AUDIENCE` naming `segmentId`

#### Scenario: Tags target with tags
- **WHEN** a user creates a broadcast with `targetType = tags` and one tag ID
- **THEN** the broadcast SHALL be created

### Requirement: Broadcast Send Stops When The Audience Cannot Be Resolved
When a broadcast is sent, manually or by the scheduler, and its audience cannot be resolved, the system SHALL send no message, SHALL mark the broadcast `failed`, and SHALL throw an error with a reason in Chinese. The audience cannot be resolved when the segment is missing or deleted, the segment has no condition with a value, or the tag or contact list is empty. The system SHALL NOT fall back to all contacts of the channel.

#### Scenario: Segment deleted before a scheduled send
- **WHEN** a scheduled broadcast targets a segment that was deleted
- **THEN** no message SHALL be sent, the broadcast SHALL be `failed`, and the error code SHALL be `INVALID_AUDIENCE`

#### Scenario: Legacy broadcast with an empty tag list
- **WHEN** a draft broadcast created before this rule has `targetType = tags` and no tag IDs, and a user sends it
- **THEN** no message SHALL be sent and the broadcast SHALL be `failed`

#### Scenario: Segment without conditions at send time
- **WHEN** a broadcast targets a segment whose conditions all have empty values
- **THEN** no message SHALL be sent and the broadcast SHALL be `failed`

### Requirement: Broadcast Send Fails When The Resolved Audience Is Empty
When a broadcast audience is valid but resolves to no channel identity, the system SHALL send no message, SHALL mark the broadcast `failed`, and SHALL throw 400 with code `BROADCAST_NO_RECIPIENTS` and a reason in Chinese. This covers tags that no contact has, selected contacts that were deleted, and a segment whose conditions match no contact. When a segment matches no contact, the system SHALL NOT query the identities of the channel.

#### Scenario: Resolved audience is empty
- **WHEN** a broadcast targets a tag that no contact has, contacts that were all deleted, or a segment that matches no contact, and a user or the scheduler sends it
- **THEN** no message SHALL be sent, the broadcast SHALL be `failed`, and the error code SHALL be `BROADCAST_NO_RECIPIENTS`

### Requirement: Segment Conditions Have Values
When a segment is created or its rules are updated, the system SHALL require at least one condition, and every condition SHALL have a non-empty value. Otherwise it SHALL respond 400 with code `INVALID_SEGMENT_RULES`. When the system counts the contacts of rules that have no condition with a value, the count SHALL be 0, not all contacts.

#### Scenario: Create a segment with an empty condition value
- **WHEN** a user creates a segment whose only condition is `channelType` with an empty value
- **THEN** the system SHALL respond 400 with code `INVALID_SEGMENT_RULES` and no segment SHALL be created

#### Scenario: Create a segment with no conditions
- **WHEN** a user creates a segment with an empty `conditions` array
- **THEN** the system SHALL respond 400 with code `INVALID_SEGMENT_RULES`

#### Scenario: Preview rules without conditions
- **WHEN** a user previews the count of rules with no condition that has a value
- **THEN** the count SHALL be 0

### Requirement: A Broadcast Is Sent Once At A Time
The system SHALL start sending a broadcast only from status `draft`, `scheduled` or `failed`, and SHALL change the status to `sending` with one conditional update. If the update changes no row, because the broadcast is already `sending` or another request started it first, the system SHALL respond 409 with code `BROADCAST_ALREADY_SENDING` and SHALL send no message. The send button in the web console SHALL be disabled while its request runs.

#### Scenario: Send a broadcast that is sending
- **WHEN** a user sends a broadcast whose status is `sending`
- **THEN** the system SHALL respond 409 with code `BROADCAST_ALREADY_SENDING` and no message SHALL be sent

#### Scenario: Two send requests at the same time
- **WHEN** two requests send the same draft broadcast and the second conditional update changes no row
- **THEN** the second request SHALL respond 409 and only the first request SHALL send messages

#### Scenario: Retry a failed broadcast
- **WHEN** a user sends a broadcast whose status is `failed`
- **THEN** the system SHALL send it again

#### Scenario: Send button while sending
- **WHEN** a user clicks the send button of a draft broadcast and the request has not finished
- **THEN** the send button of that broadcast SHALL be disabled

### Requirement: Broadcast Material Matches The Channel
When a broadcast is created with a material, the material's channel type SHALL match the broadcast channel (`line` for `LINE`, `fb` for `FB`). Otherwise the system SHALL respond 400 with code `MATERIAL_CHANNEL_MISMATCH` naming `materialId`. The web console SHALL list only the materials of the selected channel type.

#### Scenario: FB material on a LINE channel
- **WHEN** a user creates a broadcast on a `LINE` channel with a material whose channel type is `fb`
- **THEN** the system SHALL respond 400 with code `MATERIAL_CHANNEL_MISMATCH` and no broadcast SHALL be created

#### Scenario: Material list follows the channel
- **WHEN** a user selects a `LINE` channel in the create-broadcast dialog
- **THEN** the material list SHALL request only materials with channel type `line`

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

`POST /marketing/broadcasts/audience-preview` MUST 接受 `channelId`、`targetType`、`segmentId`、`targetConfig`，用和實際發送相同的受眾解析與視窗規則，回傳 `{ matched, reachable, messagingWindowHours }`，不建立群發。`messagingWindowHours` 在渠道沒有視窗時是 `null`。渠道不屬於該租戶或已停用時 MUST 回 404；受眾設定不完整時 MUST 回和建立群發相同的 400 `INVALID_AUDIENCE`。建立群發的表單 MUST 在選好渠道與受眾後顯示符合條件人數；有視窗時 MUST 一併顯示可送達人數與發送注意事項（視窗規則、略過不算失敗、視窗外需要 Meta 付費的 Marketing Messages 而本系統不支援）。FB 與 THREADS 渠道的群發按「立即發送」時，確認視窗 MUST 說明只會送給視窗內互動過的人。群發列表 MUST 在 `skippedCount` 大於 0 時顯示略過人數。

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
- **THEN** 表單顯示「符合條件 3 人，可送達 1 人」
- **AND** 顯示發送注意事項：只能發給 24 小時內傳過訊息給粉專的人，其他人略過、不算失敗；要發給 24 小時外的人需要 Meta 付費的 Marketing Messages，本系統目前不支援

#### Scenario: FB 群發立即發送前提醒

- **WHEN** 使用者對 FB 或 THREADS（IG）渠道的群發按「立即發送」
- **THEN** 確認視窗說明只會送給 24 小時內傳過訊息給粉專的人，其他人會略過
- **AND** LINE 渠道的群發確認視窗沒有這段說明

#### Scenario: 列表顯示略過人數

- **WHEN** 群發的 `skippedCount` 是 2
- **THEN** 群發列表顯示「略過 2」
