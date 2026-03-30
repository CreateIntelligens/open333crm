## ADDED Requirements

### Requirement: Real-time WebSocket Broadcasting
The system SHALL push new messages to connected frontend clients in real-time through the authoritative API bootstrap rooted at `apps/api/src/index.ts`.

#### Scenario: Pushing to online agent
- **WHEN** a new message is saved to an active conversation
- **THEN** the system pushes a WebSocket event `message.created` to clients subscribed to that conversation using the server initialized from `apps/api/src/index.ts`
