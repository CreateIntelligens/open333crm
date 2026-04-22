## MODIFIED Requirements

### Requirement: Visitor message sending
The widget SHALL send visitor text messages via `POST /api/v1/webchat/:channelId/messages` with body `{ visitorToken, contentType: "text", content: { text } }`. The message SHALL be persisted as an INBOUND message in the database and the conversation SHALL appear in the inbox.

#### Scenario: Visitor sends a text message
- **WHEN** visitor types a message and submits
- **THEN** `POST /api/v1/webchat/:channelId/messages` is called, the message is stored in DB with `direction: INBOUND, senderType: CONTACT`, and the inbox shows the new conversation message

#### Scenario: Invalid visitorToken
- **WHEN** `visitorToken` is missing or malformed (not a UUID)
- **THEN** the API returns HTTP 400 and the widget shows a generic error

## ADDED Requirements

### Requirement: Channel type values are defined as shared constants
All channel type comparisons, Prisma where conditions, and plugin declarations SHALL reference the `CHANNEL_TYPE` const from `@open333crm/shared` rather than raw string literals. This ensures compile-time typo detection and autocomplete support.

#### Scenario: Developer uses wrong channel type string
- **WHEN** a developer writes `CHANNEL_TYPE.LIEN` instead of `CHANNEL_TYPE.LINE`
- **THEN** TypeScript reports a compile-time error immediately

#### Scenario: Developer adds a new channel type
- **WHEN** a new value is added to `CHANNEL_TYPE` in `packages/shared`
- **THEN** all existing comparisons and plugin declarations remain valid, and the new value is available for use with autocomplete
