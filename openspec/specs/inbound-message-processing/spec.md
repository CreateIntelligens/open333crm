## Purpose
Define the inbound message processing contract for webhook, webchat, and chatbox callers, including behavior preservation, postback intercepts, Prisma reuse, socket payloads, and automation events.

## Requirements

### Requirement: Process inbound message facade remains compatible
The system SHALL keep the exported `processInboundMessage` function compatible with existing callers by preserving its parameter list, options object shape, and return shape.

#### Scenario: Webhook caller remains unchanged
- **WHEN** `processWebhookEvent` processes parsed channel messages
- **THEN** it SHALL continue calling `processInboundMessage(prisma, io, credentials, channel, tenantId, parsed)` without adding or changing arguments

#### Scenario: Webchat caller remains unchanged
- **WHEN** webchat persists a visitor message
- **THEN** it SHALL continue calling `processInboundMessage` with the existing `prisma`, `io`, credentials, channel, tenant id, and parsed message arguments

#### Scenario: Chatbox caller remains unchanged
- **WHEN** chatbox persists a visitor message with `conversationId`, `clientMessageId`, and `messageMetadata`
- **THEN** it SHALL continue passing those values through the existing options object without changing the caller

### Requirement: Inbound message behavior remains unchanged
The refactor SHALL preserve the observable behavior of inbound message processing for contact resolution, conversation resolution, message persistence, duplicate handling, socket events, EventBus events, and side effects.

#### Scenario: Missing contact UID
- **WHEN** a parsed inbound message has no `contactUid`
- **THEN** `processInboundMessage` SHALL return without creating a contact, channel identity, conversation, message, socket event, or EventBus event

#### Scenario: New contact and channel identity
- **WHEN** a parsed inbound message comes from a channel UID without an existing channel identity or stitched contact
- **THEN** the system SHALL create a contact, create a channel identity for the channel UID, and continue processing the inbound message

#### Scenario: Existing client message duplicate
- **WHEN** `options.clientMessageId` matches an existing message in the resolved conversation
- **THEN** `processInboundMessage` SHALL return the existing message with `duplicate: true` and SHALL NOT create another inbound message

#### Scenario: Normal inbound message saved
- **WHEN** a non-duplicate parsed inbound message is processed
- **THEN** the system SHALL create one inbound message, increment the conversation unread count, update the conversation last-message timestamp, emit `message.new`, emit `conversation.updated`, publish `message.received`, trigger canvas flow handling, and return `duplicate: false`

### Requirement: Postback intercept behavior remains unchanged
The refactor SHALL preserve existing postback/text intercept behavior for CSAT, KB feedback, and handoff requests.

#### Scenario: CSAT response intercepted
- **WHEN** inbound text or postback data matches the existing CSAT pattern
- **THEN** the system SHALL record the CSAT score and return without publishing `message.received`

#### Scenario: KB feedback intercepted
- **WHEN** inbound text or postback data matches the existing KB feedback pattern
- **THEN** the system SHALL record KB feedback, send the thank-you reply when possible, and return without publishing `message.received`

#### Scenario: Handoff request intercepted
- **WHEN** inbound text or postback data matches `handoff_request`
- **THEN** the system SHALL preserve the current idempotent handoff behavior, including botConfig handoff message lookup, conversation status transition when applicable, system message emission, `conversation.handoff` publication, and no `message.received` publication

### Requirement: Processing reuses caller-provided Prisma and per-message objects
The refactored pipeline SHALL use the `PrismaClient` object provided to `processInboundMessage` and SHALL reuse per-message context values instead of creating duplicate equivalent objects during one inbound message processing run.

#### Scenario: Prisma object reused
- **WHEN** `processInboundMessage` delegates work to internal helpers
- **THEN** those helpers SHALL use the same caller-provided `prisma` object and SHALL NOT instantiate a new Prisma client

#### Scenario: Channel settings reused within one message
- **WHEN** one inbound message processing run needs channel settings for initial conversation status, handoff message, or outside-hours offline greeting
- **THEN** the system SHALL fetch or derive those settings through a shared per-message context instead of independently rebuilding equivalent settings objects in each branch

#### Scenario: Socket payload builders reused
- **WHEN** the system emits `message.new`, media-ready `message.new`, system handoff `message.new`, office-hours `message.new`, or `conversation.updated`
- **THEN** payloads SHALL be built through shared payload builders that preserve the existing fields and room targets

### Requirement: Refactor does not alter external contracts
The refactor SHALL NOT change database schema, webhook parse contracts, socket event names, socket room names, EventBus event names, or existing route behavior.

#### Scenario: No schema migration required
- **WHEN** the refactor is implemented
- **THEN** no Prisma schema migration SHALL be required

#### Scenario: Socket contracts remain stable
- **WHEN** an inbound message produces socket events
- **THEN** clients SHALL continue receiving the same event names, room targets, and payload fields as before

#### Scenario: Automation trigger remains stable
- **WHEN** a normal inbound message completes processing
- **THEN** the system SHALL continue publishing `message.received` with the same payload fields used by existing automation handling
