## Purpose
定義 LINE Webhook 的處理：簽章驗證、30 秒內回應、解析所有 LINE 事件類型，以及收到媒體訊息時立即下載保存。
## Requirements
### Requirement: LINE Webhook signature verification
The system SHALL verify every incoming LINE Webhook request using HMAC-SHA256 computed from `channelSecret` and the raw request body, compared against the `X-Line-Signature` header.

#### Scenario: Valid signature accepted
- **WHEN** a POST request to `/webhooks/line/:channelId` has a valid `X-Line-Signature`
- **THEN** the request proceeds to event parsing

#### Scenario: Invalid signature rejected
- **WHEN** a POST request has a missing or invalid `X-Line-Signature`
- **THEN** the system responds with HTTP 403 and logs the rejection

---

### Requirement: LINE Webhook response within 30 seconds
The system SHALL respond with HTTP 200 within 30 seconds of receiving a LINE Webhook request, regardless of downstream processing time.

#### Scenario: Immediate 200 response
- **WHEN** a valid LINE Webhook is received
- **THEN** the system acknowledges with 200 before processing completes

---

### Requirement: Parse all LINE Webhook event types
The system SHALL parse and route the following LINE event types:

- `message` → `UniversalMessage` (text / image / video / audio / file / location / sticker)
- `postback` → `UniversalMessage` with `type: 'postback'`
- `follow` → Contact status update event (`channelStatus: 'active'`)
- `unfollow` → Contact status update event (`channelStatus: 'blocked'`)

#### Scenario: Text message parsed
- **WHEN** a `message` event with type `text` is received
- **THEN** a `UniversalMessage` with `messageType: 'text'` and correct `content.text` is produced

#### Scenario: Follow event updates contact
- **WHEN** a `follow` event is received for a known contact
- **THEN** `Contact.channelStatus` is updated to `'active'`

### Requirement: Parse LINE unsend, group and other events
The system SHALL also parse and route the following LINE event types:

- `join` → System event (bot joined group)
- `leave` → System event (bot left group)
- `memberJoined` → System event (member joined group)
- `memberLeft` → System event (member left group)
- `unsend` → Mark referenced message as `recalled`
- `videoPlayComplete` → Automation trigger event
- `accountLink` → Account link completion event

#### Scenario: Unsend event marks message
- **WHEN** an `unsend` event is received
- **THEN** the referenced message record is marked `recalled: true`

---

### Requirement: Immediate media download on receipt
The system SHALL parse LINE `image`, `video`, `audio` and `file` messages and download LINE-hosted content immediately upon webhook receipt. The download SHALL run asynchronously in the API process after the message is stored, without delaying the webhook response. The system SHALL call `GET /v2/bot/message/{messageId}/content`, upload the content to the Storage Layer, and write the Storage URL to both `content.url` and `content.mediaUrl` of the message.

#### Scenario: Image downloaded on receive
- **WHEN** a Webhook `message` event of type `image` with `contentProvider.type` `line` arrives
- **THEN** the system downloads the content and writes the Storage URL to `content.url` and `content.mediaUrl`

#### Scenario: Audio downloaded and stored
- **WHEN** a Webhook `message` event of type `audio` with `contentProvider.type` `line` arrives
- **THEN** the message has `contentType` `audio`, text「[語音]」and the `duration`, and the system downloads and stores the content

### Requirement: External and pending LINE media
When `contentProvider.type` is `external`, the system SHALL use `contentProvider.originalContentUrl` and SHALL NOT download. Until the download finishes, `content.contentId` marks the media as pending and `content.mediaUrl` SHALL NOT hold a placeholder.

#### Scenario: External-provider audio used directly
- **WHEN** a Webhook `message` event of type `audio` with `contentProvider.type` `external` arrives
- **THEN** `content.url` is `contentProvider.originalContentUrl` and the system does not call the content API

#### Scenario: Media URL never expires
- **WHEN** the Storage URL is written to the message
- **THEN** `content.mediaUrl` holds the Storage URL, and before that it holds no placeholder

### Requirement: LINE media download limits and failures
The system SHALL NOT download content larger than 25 MB, SHALL keep the stored MIME type only for images other than SVG, video and audio and store everything else as `application/octet-stream`, and SHALL keep the extension of a file's name. When the download fails, the system SHALL write the reason in Traditional Chinese to `content.mediaError` and notify the inbox.

#### Scenario: File larger than 25 MB
- **WHEN** a Webhook `message` event of type `file` with `fileSize` 26 MB arrives
- **THEN** the system does not call the content API and writes「檔案超過 25 MB，未下載」to `content.mediaError`

#### Scenario: Media download failed
- **WHEN** the content API returns HTTP 404 for a LINE-hosted message
- **THEN** the system writes「LINE 內容下載失敗（404）」to `content.mediaError` and sends `message.new` to the inbox

#### Scenario: File downloaded and stored
- **WHEN** a Webhook `message` event of type `file` with `fileName`「報價單.pdf」arrives
- **THEN** the message has `contentType` `file`, text「[檔案] 報價單.pdf」, `fileName` and `fileSize`, and the system stores the content with the extension `.pdf` as `application/octet-stream`
