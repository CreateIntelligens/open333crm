## MODIFIED Requirements

### Requirement: Parse all LINE Webhook event types
The system SHALL parse and route the following LINE event types:

- `message` → `UniversalMessage` (text / image / video / audio / file / location / sticker)
- `postback` → `UniversalMessage` with `type: 'postback'`
- `follow` → inbound system event with `contentType` `follow`; the system clears `blockedAt` of the channel identity
- `unfollow` → inbound system event with `contentType` `unfollow`; the system sets `blockedAt` of the channel identity to the processing time

The system SHALL record the block state per channel identity and SHALL NOT change `Contact.isBlocked`, which only an agent sets.

#### Scenario: Text message parsed
- **WHEN** a `message` event with type `text` is received
- **THEN** a `UniversalMessage` with `messageType: 'text'` and correct `content.text` is produced

#### Scenario: Follow event updates contact
- **WHEN** a `follow` event is received for a known channel identity whose `blockedAt` has a value
- **THEN** `blockedAt` of that channel identity is `null`, and `Contact.isBlocked` does not change

#### Scenario: Unfollow event records the block
- **WHEN** an `unfollow` event is received for a known channel identity
- **THEN** `blockedAt` of that channel identity has the processing time, the event is stored as an inbound message, and `Contact.isBlocked` does not change

#### Scenario: Unfollow of another channel does not change this channel
- **WHEN** a contact has identities on LINE channel A and LINE channel B, and an `unfollow` event for the uid arrives on channel A
- **THEN** only the identity on channel A has `blockedAt`; the identity on channel B keeps `blockedAt` `null`

## ADDED Requirements

### Requirement: Unfollow from an unknown user creates nothing
When an `unfollow` event arrives for a uid that has no channel identity on that channel, the system SHALL NOT create a contact, a channel identity, a conversation or a message, and SHALL NOT send any message. This applies also when the uid belongs to a merged contact of another channel.

#### Scenario: Unknown user blocks the official account
- **WHEN** an `unfollow` event arrives for a uid that has no channel identity on the LINE channel
- **THEN** the number of contacts and channel identities of the tenant does not change, no message is stored, and the system sends nothing to LINE
