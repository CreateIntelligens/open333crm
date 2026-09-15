## MODIFIED Requirements

### Requirement: Visitor session initialization
On first load the embedded widget SHALL obtain a server-issued chatbox session and page-lifetime claim through the secure chatbox session lifecycle. The widget SHALL NOT generate or persist a client-generated identifier as an authorization credential. Each browser tab SHALL be able to establish its own independent server-side session, and no conversation history SHALL be fetched or displayed on load. Chatbox mode SHALL use the same verified `sessionId` and claim lifecycle.

#### Scenario: First-time visitor loads widget
- **WHEN** no active WebChat session exists for the browser tab
- **THEN** the widget requests a server-issued session, completes the server claim flow, keeps the claim in page memory, and renders the public greeting without using a client-generated visitor token as authorization

#### Scenario: Same tab reloads widget
- **WHEN** the widget is reloaded without a reusable active page claim
- **THEN** the widget starts a new secure session or follows the documented secure restart flow and does not submit the previous raw authorization material as a visitor token

#### Scenario: Two tabs open the same widget
- **WHEN** the same embed code is loaded in two separate browser tabs
- **THEN** each tab uses an independently issued server-side session and cannot access the other tab's conversation

#### Scenario: Session API returns greeting
- **WHEN** the channel has a `welcomeMessage` in its settings and the secure session is successfully claimed
- **THEN** the greeting message is displayed in the widget chat window on the fresh session

#### Scenario: Chatbox mode uses session id instead of visitor token
- **WHEN** a visitor opens the `/chatbox` public route
- **THEN** the chatbox client uses the verified `sessionId` lifecycle and page claim instead of creating or sending an `open333crm_visitor` token

### Requirement: Visitor message sending
The widget SHALL send visitor text and media through the secure WebChat message contract with a verified `sessionId` and matching page-lifetime claim. The server SHALL derive tenant, channel, contact, and conversation scope from that verified session. Legacy visitor-token requests SHALL NOT authorize message persistence or media upload.

#### Scenario: Visitor sends a text message
- **WHEN** a visitor types a message and submits it with a valid session and claim
- **THEN** the secure message API is called, the message is stored in the database with `direction: INBOUND` and `senderType: CONTACT`, and the inbox shows the new conversation message

#### Scenario: Visitor sends an image
- **WHEN** a visitor selects a PNG or JPEG within the configured image limit using an active secure session
- **THEN** the file is uploaded through the secure media flow, the returned reference is sent in a typed message, and the inbox displays the image in the conversation

#### Scenario: Visitor sends a video
- **WHEN** a visitor selects an MP4 or MOV within the configured video limit using an active secure session
- **THEN** the file is uploaded through the secure media flow, the returned reference is sent in a typed message, and the inbox displays the video in the conversation

#### Scenario: Invalid visitorToken
- **WHEN** `sessionId` or the page claim is missing, malformed, expired, revoked, or mismatched
- **THEN** the API rejects the request before contact, conversation, message, upload, automation, or AI work and the widget shows a generic error

#### Scenario: File too large
- **WHEN** a visitor selects a file exceeding the configured size limit
- **THEN** the widget shows an alert and does not call the media API

### Requirement: Real-time message delivery to visitor
The widget SHALL connect to Socket.IO namespace `/visitor` using the verified chatbox session and page-lifetime claim. The backend SHALL assign the socket only to the canonical room for that verified session and channel when the session is valid. Client-controlled room names or arbitrary visitor tokens SHALL NOT select the delivery room.

#### Scenario: Agent replies to visitor
- **WHEN** an agent sends a message in a WEBCHAT conversation bound to the visitor's verified session
- **THEN** the visitor's widget receives an `agent:message` Socket.IO event and displays it in real time without page reload

#### Scenario: Bot replies to visitor
- **WHEN** the bot or AI generates a reply for a WEBCHAT conversation bound to the visitor's verified session
- **THEN** the visitor's widget receives an `agent:message` Socket.IO event and displays it

#### Scenario: Visitor Socket.IO auth fails
- **WHEN** the session is missing, expired, revoked, unverifiable, unclaimed, claim-token-mismatched, or not bound to the requested channel
- **THEN** the Socket.IO connection is rejected and no visitor room is joined
