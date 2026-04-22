## ADDED Requirements

### Requirement: Visitor session initialization
On first load the widget SHALL generate a UUID v4 `visitorToken` and persist it in `sessionStorage` key `open333crm_visitor`. Each browser tab maintains its own independent token, ensuring separate conversations per tab. The widget SHALL call `POST /api/v1/webchat/:channelId/sessions` with the token to obtain a greeting message. No conversation history is fetched or displayed on load.

#### Scenario: First-time visitor loads widget
- **WHEN** no `open333crm_visitor` key exists in `sessionStorage`
- **THEN** a new UUID v4 is generated, stored in `sessionStorage`, and `POST /api/v1/webchat/:channelId/sessions` is called with `{ visitorToken: "<uuid>" }`

#### Scenario: Same tab reloads widget
- **WHEN** `open333crm_visitor` key already exists in `sessionStorage`
- **THEN** the existing token is reused and `POST /api/v1/webchat/:channelId/sessions` is called

#### Scenario: Two tabs open the same widget
- **WHEN** the same embed code is loaded in two separate browser tabs
- **THEN** each tab generates its own `visitorToken`, producing two independent conversations in the inbox

#### Scenario: Session API returns greeting
- **WHEN** the channel has a `welcomeMessage` in its settings
- **THEN** the greeting message is displayed in the widget chat window on every fresh load

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

### Requirement: Real-time message delivery to visitor
The widget SHALL connect to Socket.IO namespace `/visitor` using `visitorToken` and `channelId` as auth parameters. The backend SHALL emit `agent:message` events to room `visitor:${channelId}:${visitorToken}` whenever an agent or bot sends an outbound message on a WEBCHAT conversation. Including `channelId` in the room key ensures cross-tenant isolation even if two visitors share the same UUID.

#### Scenario: Agent replies to visitor
- **WHEN** an agent sends a message in a WEBCHAT conversation
- **THEN** the visitor's widget receives an `agent:message` Socket.IO event and displays the message in real time without page reload

#### Scenario: Bot replies to visitor
- **WHEN** the bot/AI generates a reply for a WEBCHAT conversation
- **THEN** the visitor's widget receives an `agent:message` Socket.IO event and displays it

#### Scenario: Visitor Socket.IO auth fails
- **WHEN** `visitorToken` is missing or `channelId` does not exist
- **THEN** Socket.IO connection is rejected with an error event

### Requirement: Embeddable widget bundle
The web public runtime SHALL serve the compiled widget JS bundle at `GET /webchat/widget.js` as a static file. The embed code generator SHALL produce a `<script>` tag pointing to this URL, using `WEB_BASE_URL` when configured and otherwise deriving the public widget origin from the API base URL. The embed bootstrap SHALL populate `window.Open333CRM.apiBaseUrl`, and the widget SHALL attach a launcher button to the host page without conflicting with the page's own JS.

#### Scenario: Customer installs embed code
- **WHEN** the embed `<script>` tag is added to a webpage
- **THEN** the widget JS loads from the configured public widget origin, a chat launcher button appears in the bottom-right corner, and no JS errors are thrown on the host page

#### Scenario: Widget bundle served correctly
- **WHEN** `GET /webchat/widget.js` is requested from the public origin
- **THEN** the web runtime responds with JavaScript bundle content for the embeddable widget

### Requirement: Widget message submission respects IME composition
The widget SHALL NOT submit a message when the Enter key is pressed while IME composition is active. Enter submission SHALL only occur after composition ends.

#### Scenario: Visitor is choosing a Chinese candidate
- **WHEN** the visitor presses Enter to confirm an IME candidate in the widget input
- **THEN** the widget does not send the message and keeps the input focused for continued editing

#### Scenario: Visitor sends after composition completes
- **WHEN** IME composition has ended and the visitor presses Enter without Shift
- **THEN** the widget sends the current text message once

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
