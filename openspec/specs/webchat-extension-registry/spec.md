## Purpose
Define extension points for chatbox message handling, session verification, i18n behavior, and ChannelPlugin boundary reuse.

## Requirements

### Requirement: Fastify message type registry
The API SHALL expose a Fastify decorator for registering WebChat message type handlers. Handlers SHALL parse visitor input, map payloads to persisted message content, and serialize messages for visitor and agent clients.

#### Scenario: Register emoji message type
- **WHEN** the API registers an emoji message type handler
- **THEN** chatbox messages with `type: "emoji"` are validated and serialized through that handler

#### Scenario: Unknown message type
- **WHEN** no handler is registered for a submitted message type
- **THEN** the API rejects the message before persistence

### Requirement: ChannelPlugin boundary reuse
The chatbox implementation SHALL reuse existing ChannelPlugin boundary semantics when adapting verified chatbox messages into WEBCHAT channel messages. The implementation SHALL NOT change the existing `WebchatPlugin` public contract or make `WebchatPlugin` responsible for visitor Socket.IO delivery.

#### Scenario: Chatbox message enters WEBCHAT channel pipeline
- **WHEN** a verified chatbox visitor sends a supported message
- **THEN** the system adapts it into the existing WEBCHAT channel message pipeline without bypassing tenant, channel, and message validation

#### Scenario: WebchatPlugin contract remains unchanged
- **WHEN** existing embedded WebChat or agent outbound WEBCHAT flows call `WebchatPlugin.sendMessage`
- **THEN** the plugin behavior remains compatible with the existing contract and does not gain chatbox-specific session verification or Socket.IO delivery responsibility

#### Scenario: Chatbox session logic stays outside plugin
- **WHEN** the system verifies `sessionId`, expiry, fingerprint, or revocation state
- **THEN** that verification is handled by chatbox session services or Fastify decorators rather than by `WebchatPlugin`

### Requirement: Fastify chatbox session verifier
The API SHALL expose a Fastify decorator for verifying chatbox sessions in routes and socket authentication. The verifier SHALL check token validity, server session row, expiry, revocation, channel state, and fingerprint policy.

#### Scenario: Route uses session verifier
- **WHEN** a chatbox message route receives a request
- **THEN** it verifies the session through the chatbox session verifier before parsing or persisting the message

#### Scenario: Socket uses session verifier
- **WHEN** a visitor socket connects with a chatbox `sessionId`
- **THEN** socket authentication verifies the session through the same verifier logic used by HTTP routes

### Requirement: Fastify chatbox i18n registry
The API SHALL expose a locale/i18n decorator for resolving visitor locale and translating public chatbox errors, validation messages, and system copy.

#### Scenario: Resolve visitor locale
- **WHEN** a chatbox request includes locale hints
- **THEN** the i18n registry resolves a supported locale for public chatbox responses

#### Scenario: Translate validation error
- **WHEN** a chatbox request fails validation
- **THEN** the public error copy can be translated through the i18n registry without changing route logic

### Requirement: Extension registries initialize at API boot
The system SHALL register built-in chatbox message type handlers and i18n behavior during API startup before public chatbox routes are available.

#### Scenario: Built-in handlers available
- **WHEN** the API starts
- **THEN** built-in handlers for text, image, video, file, emoji, and system messages are registered before chatbox routes process requests
