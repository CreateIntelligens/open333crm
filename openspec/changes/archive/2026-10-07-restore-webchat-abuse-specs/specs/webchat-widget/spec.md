## MODIFIED Requirements

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
