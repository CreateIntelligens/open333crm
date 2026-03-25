# Threads Channel Plugin

## ADDED Requirements

### Requirement: Threads Plugin Registration
The system SHALL provide a ThreadsPlugin that implements the ChannelPlugin interface and can be registered in the Plugin Registry.

#### Scenario: Plugin Registration
- **WHEN** the application starts
- **THEN** the ThreadsPlugin SHALL be registered with channelType 'THREADS'

### Requirement: Webhook Verification
The system SHALL verify incoming requests from Threads using the Instagram Webhook verification process.

#### Scenario: Valid Verification Request
- **WHEN** Instagram sends a GET request to the webhook URL for verification
- **THEN** the system SHALL respond with the hub.challenge parameter for Facebook's verification

#### Scenario: Webhook Message
- **WHEN** Threads sends a webhook notification with messages
- **THEN** the verifySignature method SHALL validate the request using the app secret

### Requirement: Message Parsing
The system SHALL parse incoming Threads/Instagram Direct messages into UniversalMessage format.

#### Scenario: Text Message
- **WHEN** Threads sends a text message via DM
- **THEN** the parseWebhook method SHALL return a UniversalMessage with messageType 'text' and content.text populated

#### Scenario: Image Message
- **WHEN** Threads sends an image message via DM
- **THEN** the parseWebhook method SHALL return a UniversalMessage with messageType 'image' and content.mediaUrl pointing to the image

#### Scenario: Story Reply
- **WHEN** a user replies to a Story
- **THEN** the parseWebhook method SHALL return a UniversalMessage with messageType 'text' indicating it's a story reply

#### Scenario: Like (Heart) Reaction
- **WHEN** a user likes a message with a heart
- **THEN** the parseWebhook method SHALL return a UniversalMessage with messageType 'sticker' or 'text' indicating the reaction

### Requirement: Profile Retrieval
The system SHALL be able to retrieve user profile information from Instagram Graph API.

#### Scenario: Get Profile
- **WHEN** getProfile is called with an Instagram user ID
- **THEN** it SHALL return a ContactProfile with username, name, and profileImageUrl

### Requirement: Message Sending
The system SHALL be able to send messages to Instagram users via the Instagram Graph API.

#### Scenario: Send Text Reply
- **WHEN** sendMessage is called with a text message
- **THEN** it SHALL call Instagram's Direct API and return a SendResult with success=true

#### Scenario: Send Image Reply
- **WHEN** sendMessage is called with an image message
- **THEN** it SHALL upload the image to Instagram's Media Library and send as a DM, returning a SendResult with success=true

#### Scenario: Send Quick Reply Button
- **WHEN** sendMessage is called with quickReplies
- **THEN** it SHALL send a message with action buttons and return a SendResult
