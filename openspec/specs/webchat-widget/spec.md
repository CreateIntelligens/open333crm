## Purpose
Define embedded WebChat widget behavior and its boundaries relative to standalone chatbox sessions.

## Requirements

### Requirement: Visitor session initialization
On each page load, the embedded widget SHALL create a chatbox session with `POST /api/v1/chatbox/sessions` and claim it with `POST /api/v1/chatbox/sessions/verify`, as `webchat-secure-session` describes. The widget SHALL keep the `sessionId` and the claim token in page memory only. The widget SHALL NOT generate, store or send a visitor token. The widget does not fetch or display conversation history on load. Chatbox mode SHALL use the same session lifecycle.

#### Scenario: First-time visitor loads widget
- **WHEN** the widget loads on a page
- **THEN** the widget calls `POST /api/v1/chatbox/sessions` with the channel public key, then calls `POST /api/v1/chatbox/sessions/verify` with the issued `sessionId`, sends no `visitorToken`, and writes nothing to `sessionStorage` or `localStorage`

#### Scenario: Same tab reloads widget
- **WHEN** the widget loads again in the same tab
- **THEN** the widget creates and claims a new session and does not send the previous `sessionId`

#### Scenario: Two tabs open the same widget
- **WHEN** the same embed code loads in two browser tabs
- **THEN** each tab creates and claims its own session

#### Scenario: Session API returns greeting
- **WHEN** the verify response contains a greeting from the channel `welcomeMessage`
- **THEN** the widget displays the greeting as the first message

#### Scenario: Chatbox mode uses session id instead of visitor token
- **WHEN** a visitor opens `/chatbox?sessionId=<id>`
- **THEN** the page claims that session with `POST /api/v1/chatbox/sessions/verify`, connects to the visitor socket with the `sessionId` and the claim token, and does not create or send an `open333crm_visitor` token

### Requirement: Visitor message sending
The widget SHALL send each text message, and each image or video after its upload, to `POST /api/v1/webchat/:channelId/messages` with the `sessionId` and the claim token. The widget SHALL upload files to `POST /api/v1/webchat/:channelId/media`. The API SHALL verify the session and the claim token before it stores a message or a file. The API SHALL reject a session that belongs to a different channel. When a send fails, the widget SHALL show an error.

#### Scenario: Visitor sends a text message
- **WHEN** a visitor submits text
- **THEN** the widget sends `{ sessionId, claimToken, clientMessageId, type: "text", payload: { text } }` without a `visitorToken`, and the API gives the message to the inbound pipeline with the tenant and the conversation of the verified session

#### Scenario: Visitor sends an image
- **WHEN** a visitor selects a PNG or JPEG file of 20 MB or less
- **THEN** the widget uploads the file with the `sessionId` and the claim token, then sends a message with `type: "image"` and `payload: { url }` from the upload response, and the API stores the file for the channel of the verified session

#### Scenario: Visitor sends a video
- **WHEN** a visitor selects an MP4 or MOV file of 25 MB or less
- **THEN** the widget uploads the file with the `sessionId` and the claim token, then sends a message with `type: "video"` and `payload: { url }` from the upload response

#### Scenario: Invalid visitorToken
- **WHEN** a message or upload request has no `sessionId` or claim token, or the session fails verification
- **THEN** the API rejects the request and does not give a message to the inbound pipeline or store a file

#### Scenario: Session belongs to another channel
- **WHEN** a request to `/api/v1/webchat/:channelId/messages` or `/media` has a verified session of a different channel
- **THEN** the API returns 404 and does not give a message to the inbound pipeline or store a file

#### Scenario: Message send fails
- **WHEN** the API rejects a text message or an upload
- **THEN** the widget shows the visitor that the send failed

#### Scenario: File too large
- **WHEN** a visitor selects an image over 20 MB, a video over 25 MB, or a file of another type
- **THEN** the widget shows an alert and does not call the media API

### Requirement: Real-time message delivery to visitor
The widget SHALL connect to the Socket.IO namespace `/visitor` with the `sessionId` and the claim token, and SHALL display each `agent:message` event. The namespace authenticates the socket as `webchat-secure-session` describes. A verified socket SHALL join the room `visitor:<channelId>:<visitorToken>`, with both values from the session record. When an agent or the bot replies in a WEBCHAT conversation, the API SHALL emit `agent:message` to that room.

#### Scenario: Widget connects with the claimed session
- **WHEN** the widget has claimed a session
- **THEN** the widget connects to `/visitor` with `sessionId` and `claimToken` as auth parameters and sends no `visitorToken`

#### Scenario: Verified socket joins the session room
- **WHEN** a visitor socket passes verification, and its auth parameters also contain a different `channelId` and `visitorToken`
- **THEN** the socket joins `visitor:<channelId>:<visitorToken>` with the values from the session record

#### Scenario: Agent replies to visitor
- **WHEN** an agent sends a message in a WEBCHAT conversation
- **THEN** the API emits `agent:message` in the `/visitor` namespace to the room of the contact's WEBCHAT identity, and the widget displays the message without a page reload

#### Scenario: Bot replies to visitor
- **WHEN** the API delivers a bot or AI reply in a WEBCHAT conversation
- **THEN** the API publishes an `agent:message` event for the `/visitor` namespace and the room of the contact's WEBCHAT identity through the Redis socket bridge

#### Scenario: Visitor Socket.IO auth fails
- **WHEN** a visitor socket has no `sessionId` or claim token, or the session fails verification
- **THEN** the API rejects the connection and the socket joins no room

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

### Requirement: Chatbox client does not replay server history
The chatbox client SHALL NOT request or render persisted server-side conversation history during bootstrap or refresh. It SHALL only render messages created or received during the current browser page lifetime.

#### Scenario: Chatbox refresh
- **WHEN** a visitor refreshes `/chatbox?sessionId=<valid>`
- **THEN** the client verifies the session and keeps the same server-side conversation without receiving prior persisted messages

#### Scenario: New inbound socket message
- **WHEN** an agent sends a new message after the refreshed chatbox page connects
- **THEN** the client renders that new socket message in the current page lifetime

### Requirement: Widget shows each message on the side of its sender
The widget SHALL show the messages that the visitor sends on the right side with the `o333-msg-out` style. This includes text, images, videos, and the placeholder that the widget shows while a file uploads. The widget SHALL show agent replies, bot replies and the greeting on the left side with the `o333-msg-in` style.

#### Scenario: Visitor message is on the visitor's side
- **WHEN** a visitor submits text
- **THEN** the widget shows the message with the `o333-msg-out` class and not the `o333-msg-in` class

#### Scenario: Agent and bot messages are on the other side
- **WHEN** the widget shows the greeting, or receives an `agent:message` event
- **THEN** the widget shows the message with the `o333-msg-in` class and not the `o333-msg-out` class

#### Scenario: Visitor media placeholder is on the visitor's side
- **WHEN** a visitor selects an image or a video and the upload has not finished
- **THEN** the placeholder message has the `o333-msg-out` class
