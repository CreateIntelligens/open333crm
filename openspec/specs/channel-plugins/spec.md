## ADDED Requirements

### Requirement: Standard Integration Interface
The system SHALL provide a unified adapter interface for all external IM channels to send and receive messages through channel plugins registered by the authoritative API bootstrap rooted at `apps/api/src/index.ts`.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into a standard `UniversalMessage` and passes it to the Core Inbox through the runtime initialized from `apps/api/src/index.ts`
