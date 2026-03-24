## ADDED Requirements

### Requirement: Standard Integration Interface
The system SHALL provide a unified adapter interface for all external IM channels to send and receive messages.

#### Scenario: Channel plugin receiving webhook
- **WHEN** an external HTTP webhook hits a specific channel's adapter
- **THEN** the adapter transforms the payload into a standard `UniversalMessage` and passes it to the Core Inbox

### Requirement: Self-Service Channel Binding
The system SHALL allow admins to configure new channels without deploying new code.

#### Scenario: Binding a new LINE channel
- **WHEN** an admin supplies a valid channel secret and access token
- **THEN** the system registers the channel and automatically issues a webhook URL for it
