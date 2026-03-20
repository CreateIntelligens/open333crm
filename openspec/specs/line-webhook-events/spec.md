## ADDED Requirements

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
- `join` → System event (bot joined group)
- `leave` → System event (bot left group)
- `memberJoined` → System event (member joined group)
- `memberLeft` → System event (member left group)
- `unsend` → Mark referenced message as `recalled`
- `videoPlayComplete` → Automation trigger event
- `accountLink` → Account link completion event

#### Scenario: Text message parsed
- **WHEN** a `message` event with type `text` is received
- **THEN** a `UniversalMessage` with `messageType: 'text'` and correct `content.text` is produced

#### Scenario: Follow event updates contact
- **WHEN** a `follow` event is received for a known contact
- **THEN** `Contact.channelStatus` is updated to `'active'`

#### Scenario: Unsend event marks message
- **WHEN** an `unsend` event is received
- **THEN** the referenced message record is marked `recalled: true`

---

### Requirement: Immediate media download on receipt
The system SHALL download all media content (image / video / audio / file) from LINE's temporary URL immediately upon webhook receipt and store it in the Storage Layer.

#### Scenario: Image downloaded on receive
- **WHEN** a Webhook `message` event of type `image` arrives
- **THEN** the system enqueues a BullMQ job to download from `GET /v2/bot/message/{messageId}/content` and upload to Storage Layer
- **THEN** `Message.mediaUrl` is updated with the permanent Storage URL

#### Scenario: Media URL never expires
- **WHEN** the Storage Layer URL is written to the Message record
- **THEN** the original LINE temporary URL is no longer referenced
