## MODIFIED Requirements

### Requirement: Threads Plugin Registration
The system SHALL provide a ThreadsPlugin that implements the ChannelPlugin interface. The API process SHALL register it in the Plugin Registry, and the workers process SHALL register it in its own plugin registry, so that automation rules can send messages to Instagram conversations.

#### Scenario: Plugin Registration
- **WHEN** the application starts
- **THEN** the ThreadsPlugin SHALL be registered with channelType 'THREADS'

#### Scenario: Workers send to Instagram
- **WHEN** an automation rule runs `send_message` in an Instagram conversation
- **THEN** the workers SHALL send the message through the ThreadsPlugin and SHALL NOT record a "no plugin" delivery failure
