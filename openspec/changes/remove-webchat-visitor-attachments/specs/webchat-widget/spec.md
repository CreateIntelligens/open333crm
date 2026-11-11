## REMOVED Requirements

### Requirement: Visitor message sending
**Reason**: 訪客不能再傳圖片與影片。需求改寫為「Visitor sends text messages only」。
**Migration**: 訪客改用文字描述需求；客服仍可在收件匣傳圖片、影片給訪客。

### Requirement: Widget shows each message on the side of its sender
**Reason**: 這個需求包含上傳中的佔位訊息，上傳功能移除後改寫為「Widget shows visitor and agent messages on separate sides」。
**Migration**: 無。

## ADDED Requirements

### Requirement: Visitor sends text messages only
The widget and the `/chatbox` page SHALL send each text message to the messages API with the `sessionId` and the claim token. They SHALL NOT show a control to attach an image, a video or a file. The API SHALL verify the session and the claim token before it stores a message. The API SHALL reject a session that belongs to a different channel. When a send fails, the widget SHALL show an error.

#### Scenario: Visitor sends a text message
- **WHEN** a visitor submits text
- **THEN** the widget sends `{ sessionId, claimToken, clientMessageId, type: "text", payload: { text } }` without a `visitorToken`, and the API gives the message to the inbound pipeline with the tenant and the conversation of the verified session

#### Scenario: Visitor sends an image
- **WHEN** the widget or the `/chatbox` page shows the message composer
- **THEN** the composer has no attach button and no file input

#### Scenario: Invalid visitorToken
- **WHEN** a message request has no `sessionId` or claim token, or the session fails verification
- **THEN** the API rejects the request and does not give a message to the inbound pipeline

#### Scenario: Session belongs to another channel
- **WHEN** a request to `/api/v1/webchat/:channelId/messages` has a verified session of a different channel
- **THEN** the API returns 404 and does not give a message to the inbound pipeline

#### Scenario: Message send fails
- **WHEN** the API rejects a text message
- **THEN** the widget shows the visitor that the send failed

### Requirement: Visitor upload routes are disabled
`POST /api/v1/chatbox/media` and `POST /api/v1/webchat/:channelId/media` SHALL return 410 with the code `WEBCHAT_VISITOR_MEDIA_DISABLED`. The routes SHALL NOT verify a session and SHALL NOT store a file.

#### Scenario: Visitor uploads a file to the chatbox route
- **WHEN** a client posts a PNG file to `POST /api/v1/chatbox/media` with a `sessionId` and a claim token
- **THEN** the API returns 410 `WEBCHAT_VISITOR_MEDIA_DISABLED`, does not verify the session and does not store the file

#### Scenario: Visitor uploads a file to the legacy route
- **WHEN** a client posts a PNG file to `POST /api/v1/webchat/:channelId/media`
- **THEN** the API returns 410 `WEBCHAT_VISITOR_MEDIA_DISABLED` and does not store the file

### Requirement: Widget shows visitor and agent messages on separate sides
The widget SHALL show the messages that the visitor sends on the right side with the `o333-msg-out` style. The widget SHALL show agent replies, bot replies and the greeting on the left side with the `o333-msg-in` style.

#### Scenario: Visitor message is on the visitor's side
- **WHEN** a visitor submits text
- **THEN** the widget shows the message with the `o333-msg-out` class and not the `o333-msg-in` class

#### Scenario: Agent and bot messages are on the other side
- **WHEN** the widget shows the greeting, or receives an `agent:message` event
- **THEN** the widget shows the message with the `o333-msg-in` class and not the `o333-msg-out` class
