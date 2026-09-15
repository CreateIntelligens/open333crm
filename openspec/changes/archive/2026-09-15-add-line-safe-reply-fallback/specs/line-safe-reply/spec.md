## Purpose

確保 LINE webhook 後的回覆不依賴短效 reply token；當研究或自動化超過安全時間，系統會改用 push 完成訊息送達。

## ADDED Requirements

### Requirement: Safe LINE delivery strategy

The system SHALL use LINE reply only when a non-empty reply token exists and the elapsed time from inbound receipt is less than 30 seconds. Otherwise, it SHALL use LINE push.

#### Scenario: Reply within safe window
- **WHEN** a LINE reply token exists and delivery starts before 30 seconds after inbound receipt
- **THEN** the system SHALL attempt the LINE reply API

#### Scenario: Agent completes after 30 seconds
- **WHEN** an Agent or asynchronous automation completes at or after 30 seconds
- **THEN** the system SHALL send the completed message with LINE push and SHALL not attempt reply

### Requirement: Reply failure fallback

The system SHALL retry a failed LINE reply exactly once as a LINE push to the same recipient. A successful reply SHALL not be followed by push in the same delivery operation.

#### Scenario: Reply API fails
- **WHEN** the LINE reply API throws or returns an unsuccessful result
- **THEN** the system SHALL attempt one push delivery and report failure only if that push also fails

### Requirement: Delivery metadata propagation

The system SHALL propagate the inbound receipt timestamp and reply token through message.received, keyword automation, KB auto-reply, and Agent reply paths. Missing metadata SHALL result in push delivery rather than an unsafe reply attempt.

#### Scenario: Missing receipt timestamp
- **WHEN** a reply token is present but the original receipt timestamp is missing or invalid
- **THEN** the system SHALL use push delivery

### Requirement: Non-LINE compatibility

The system SHALL preserve the existing delivery behavior for non-LINE channels and for explicit push messages. The fallback SHALL not create a second CRM message record.

#### Scenario: Non-LINE delivery
- **WHEN** the same delivery abstraction sends to Facebook, WebChat, or another non-LINE channel
- **THEN** the system SHALL use that channel's existing send behavior without LINE reply logic
