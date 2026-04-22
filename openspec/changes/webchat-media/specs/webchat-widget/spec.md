## MODIFIED Requirements

### Requirement: Visitor message sending
The widget SHALL send visitor text messages via `POST /api/v1/webchat/:channelId/messages` with body `{ visitorToken, contentType: "text", content: { text } }`. The widget SHALL also send media messages via a two-step flow: first upload to `POST /api/v1/webchat/:channelId/media` (multipart), then send `{ visitorToken, contentType: "image"|"video", content: { url } }` to messages. All messages SHALL be persisted as INBOUND messages in the database and the conversation SHALL appear in the inbox.

#### Scenario: Visitor sends a text message
- **WHEN** visitor types a message and submits
- **THEN** `POST /api/v1/webchat/:channelId/messages` is called, the message is stored in DB with `direction: INBOUND, senderType: CONTACT`, and the inbox shows the new conversation message

#### Scenario: Visitor sends an image
- **WHEN** visitor selects an image file (PNG/JPEG ≤ 20 MB) via the widget attachment button
- **THEN** the file is uploaded to `POST /api/v1/webchat/:channelId/media`, stored in MinIO, and the returned URL is sent via messages with `contentType: "image"` and `content: { url }`; the inbox displays the image in the conversation

#### Scenario: Visitor sends a video
- **WHEN** visitor selects a video file (MP4/MOV ≤ 25 MB) via the widget attachment button
- **THEN** the file is uploaded to `POST /api/v1/webchat/:channelId/media`, stored in MinIO, and the returned URL is sent via messages with `contentType: "video"` and `content: { url }`; the inbox displays the video in the conversation

#### Scenario: Invalid visitorToken
- **WHEN** `visitorToken` is missing or malformed (not a UUID)
- **THEN** the API returns HTTP 400 and the widget shows a generic error

#### Scenario: File too large
- **WHEN** visitor selects a file exceeding the size limit
- **THEN** the widget shows an alert and does NOT call the media API

## ADDED Requirements

### Requirement: Widget renders image and video messages
The widget's `appendMessage` SHALL render inbound/outbound messages by `contentType`. For `image` it SHALL render an `<img>` tag with the URL. For `video` it SHALL render a `<video controls>` element. For `text` it SHALL continue rendering the text string. Unknown types SHALL render a `[unsupported]` fallback.

#### Scenario: Incoming agent image message
- **WHEN** an `agent:message` Socket.IO event is received with `contentType: "image"` and `content.url`
- **THEN** the widget renders an `<img>` element in the chat window showing the image

#### Scenario: Incoming agent video message
- **WHEN** an `agent:message` Socket.IO event is received with `contentType: "video"` and `content.url`
- **THEN** the widget renders a `<video controls>` element in the chat window

### Requirement: Agent can send image/video to a WEBCHAT conversation
The `send-image` and `send-video` conversation endpoints SHALL support `WEBCHAT` channel type. When the channel is WEBCHAT, the uploaded file is stored in MinIO and delivered to the visitor via the existing `agent:message` Socket.IO event (no external API call required).

#### Scenario: Agent sends image to WEBCHAT visitor
- **WHEN** `POST /api/v1/conversations/:id/send-image` is called and the conversation is on the `WEBCHAT` channel
- **THEN** the image is uploaded to MinIO, a `Message` (OUTBOUND) is created, `agent:message` socket event is emitted to the visitor, and `message.new` is emitted to the inbox

#### Scenario: Agent sends video to WEBCHAT visitor
- **WHEN** `POST /api/v1/conversations/:id/send-video` is called and the conversation is on the `WEBCHAT` channel
- **THEN** the video is uploaded to MinIO, a `Message` (OUTBOUND) is created, `agent:message` socket event is emitted to the visitor, and `message.new` is emitted to the inbox

### Requirement: Inbox MessageInput supports WEBCHAT media
The inbox `MessageInput` component's attachment button SHALL be enabled for `WEBCHAT` channel type, allowing agents to select and send images.

#### Scenario: Agent clicks attachment in WEBCHAT conversation
- **WHEN** the conversation `channelType` is `WEBCHAT` and the agent selects a PNG/JPEG file
- **THEN** `POST /api/v1/conversations/:id/send-image` is called and the image appears in the conversation
