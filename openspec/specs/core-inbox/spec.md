## ADDED Requirements

### Requirement: Uniform Message Schema
The system SHALL standardize all incoming messages from disparate channels into a single universal message format in the database.

#### Scenario: Normalizing incoming message
- **WHEN** a channel plugin forwards a received message
- **THEN** it is saved to the PostgreSQL database with standard fields (conversation ID, content type, sender type)

### Requirement: Real-time WebSocket Broadcasting
The system SHALL push new messages to connected frontend clients in real-time.

#### Scenario: Pushing to online agent
- **WHEN** a new message is saved to an active conversation
- **THEN** the system pushes a WebSocket event `message.created` to clients subscribed to that conversation
