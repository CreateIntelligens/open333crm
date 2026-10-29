## MODIFIED Requirements

### Requirement: Unified WebChat message input
The system SHALL define a shared visitor message input contract that includes `sessionId`, `clientMessageId`, message `type`, typed `payload`, optional locale, and optional client `sentAt`. The server SHALL validate the payload according to the message type before persisting or forwarding the message. The server SHALL reject a visitor message of type `image`, `video` or `file` with 400.

#### Scenario: Text message input
- **WHEN** a visitor sends a text message through chatbox APIs
- **THEN** the request uses the shared message input contract with `type: "text"` and `payload.text`

#### Scenario: Image message input
- **WHEN** a visitor sends a message with `type` `image`, `video` or `file` through chatbox APIs
- **THEN** the API returns 400 and does not give the message to the inbound pipeline

#### Scenario: Unsupported message type
- **WHEN** a visitor sends a message type that is not registered or allowed
- **THEN** the API rejects the request with a validation error and does not persist a message

## REMOVED Requirements

### Requirement: Media messages follow upload then message flow
**Reason**: 訪客不能再上傳媒體，見 `webchat-widget` 的「Visitor upload routes are disabled」。
**Migration**: 無。客服傳給訪客的媒體訊息不受影響。
