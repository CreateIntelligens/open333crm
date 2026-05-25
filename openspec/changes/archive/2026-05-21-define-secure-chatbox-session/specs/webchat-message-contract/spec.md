## ADDED Requirements

### Requirement: Unified WebChat message input
The system SHALL define a shared visitor message input contract that includes `sessionId`, `clientMessageId`, message `type`, typed `payload`, optional locale, and optional client `sentAt`. The server SHALL validate the payload according to the message type before persisting or forwarding the message.

#### Scenario: Text message input
- **WHEN** a visitor sends a text message through chatbox APIs
- **THEN** the request uses the shared message input contract with `type: "text"` and `payload.text`

#### Scenario: Image message input
- **WHEN** a visitor sends an uploaded image through chatbox APIs
- **THEN** the request uses the shared message input contract with `type: "image"` and a payload referencing the uploaded media

#### Scenario: Unsupported message type
- **WHEN** a visitor sends a message type that is not registered or allowed
- **THEN** the API rejects the request with a validation error and does not persist a message

### Requirement: Unified WebChat message output
The system SHALL define a shared message output contract for visitor and agent clients. The output SHALL include server message id, direction, sender metadata, message type, payload, server `createdAt`, optional sequence, and optional delivery status.

#### Scenario: Visitor receives agent message
- **WHEN** an agent sends a chatbox-compatible message to the visitor
- **THEN** the visitor socket event uses the shared message output contract

#### Scenario: Agent sees visitor message
- **WHEN** a visitor sends a chatbox message
- **THEN** the dashboard receives or fetches a message representation compatible with the shared message output contract

### Requirement: Message timestamps and ordering
The system SHALL attach server-side timestamps to chatbox messages and SHALL sort displayed messages by deterministic server-controlled ordering.

#### Scenario: Server timestamp is authoritative
- **WHEN** a visitor sends a message with a client `sentAt`
- **THEN** the persisted and displayed authoritative timestamp is the server `createdAt`

#### Scenario: Messages sort by sequence
- **WHEN** messages include a server sequence value
- **THEN** clients sort by `sequence ASC`, then `createdAt ASC`, then `id ASC`

#### Scenario: Messages sort without sequence
- **WHEN** messages do not include a server sequence value
- **THEN** clients sort by `createdAt ASC`, then `id ASC`

### Requirement: Client message idempotency
The system SHALL use `clientMessageId` to prevent duplicate message persistence when a visitor retries the same chatbox send request.

#### Scenario: Duplicate client message id
- **WHEN** the same chatbox session submits the same `clientMessageId` more than once
- **THEN** the system returns the original acknowledgement and does not create duplicate messages

#### Scenario: Same client message id in different session
- **WHEN** two different chatbox sessions use the same `clientMessageId`
- **THEN** each session can persist its own message independently

### Requirement: Media messages follow upload then message flow
The system SHALL keep media submission as a two-step flow: upload media first, then send a typed message referencing the uploaded media.

#### Scenario: Visitor uploads image before message
- **WHEN** a visitor selects an image for chatbox
- **THEN** the client uploads the file, receives a media reference, and sends a typed image message referencing that media

#### Scenario: Upload validation fails
- **WHEN** a visitor uploads a file with an unsupported MIME type or size
- **THEN** the API rejects the upload and the client does not send a media message
