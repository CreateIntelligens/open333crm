## Purpose
Define secure standalone chatbox sessions, verification, expiry, fingerprint policy, and visitor socket authentication for public WebChat conversations.

## Requirements

### Requirement: Fixed chatbox route creates signed sessions
The system SHALL provide a public `/chatbox` route that creates a signed chatbox session when no valid `sessionId` is provided. The issued `sessionId` SHALL contain enough entropy to resist guessing, SHALL be protected against tampering, and SHALL be stored server-side only as a digest.

#### Scenario: Visitor opens chatbox without session
- **WHEN** a visitor opens `/chatbox` without a valid `sessionId`
- **THEN** the system creates a new chatbox session, creates a new WEBCHAT conversation, and redirects the browser to `/chatbox` with the issued `sessionId`

#### Scenario: Raw session token is not stored
- **WHEN** a chatbox session is created
- **THEN** the database stores a digest of the token material and does not store the raw public `sessionId`

#### Scenario: Session id cannot be tampered
- **WHEN** a visitor submits a `sessionId` whose signature or digest does not verify
- **THEN** the system rejects the session and does not expose chatbox config or conversation data

### Requirement: Chatbox session refresh reuses conversation
The system SHALL treat a valid unexpired `sessionId` as the refresh boundary for the chatbox. A refresh with the same valid `sessionId` SHALL continue the same chatbox session and conversation without creating duplicates.

#### Scenario: Refresh with same session
- **WHEN** a visitor refreshes `/chatbox?sessionId=<valid>`
- **THEN** the system verifies the session and continues the same WEBCHAT conversation linked to that session

#### Scenario: New issued session creates separate conversation
- **WHEN** a visitor receives a newly issued `sessionId`
- **THEN** the system creates a separate WEBCHAT conversation for that session

### Requirement: Chatbox sessions expire and can be revoked
The system SHALL enforce an expiration time for every chatbox session and SHALL allow invalid or revoked sessions to be rejected without exposing history or conversation metadata to the visitor client.

#### Scenario: Expired session is rejected
- **WHEN** a visitor opens `/chatbox` with an expired `sessionId`
- **THEN** the system rejects the session and shows a safe restart or unavailable state without returning conversation messages

#### Scenario: Revoked session is rejected
- **WHEN** a visitor opens `/chatbox` with a revoked `sessionId`
- **THEN** the system rejects the session and does not allow sending or receiving messages through that session

### Requirement: Fingerprint mismatch detection
The system SHALL bind chatbox sessions to a weak normalized fingerprint and SHALL detect likely session leakage using coarse browser characteristics. Fingerprint checks SHALL NOT use invasive browser fingerprinting techniques.

#### Scenario: Fingerprint matches
- **WHEN** a visitor opens a chatbox session from a browser whose normalized fingerprint matches the session
- **THEN** the system allows the session to continue

#### Scenario: Fingerprint strongly mismatches
- **WHEN** a visitor opens a chatbox session from a browser whose normalized fingerprint strongly mismatches the session
- **THEN** the system rejects or revokes the session according to chatbox policy without returning conversation messages

#### Scenario: Fingerprint source excludes invasive signals
- **WHEN** the client computes fingerprint input
- **THEN** it uses coarse browser, OS, language, timezone, and screen bucket signals and does not use canvas or WebGL fingerprinting

### Requirement: Visitor cannot read chatbox history
The chatbox visitor API SHALL NOT expose persisted conversation history to the visitor client. Bootstrap and verification responses SHALL include only session status and public channel configuration needed to render the chatbox.

#### Scenario: Bootstrap omits messages
- **WHEN** a visitor verifies a valid chatbox session
- **THEN** the response includes session expiry and public chatbox config but does not include persisted messages

#### Scenario: Agent can still read history
- **WHEN** an authenticated agent opens the linked conversation in the dashboard
- **THEN** the agent can read the conversation history through existing authenticated inbox APIs

### Requirement: Chatbox visitor socket authentication
The visitor Socket.IO namespace SHALL accept chatbox sessions only after verifying the `sessionId`, expiry, revocation state, channel ownership, and fingerprint policy.

#### Scenario: Valid chatbox socket joins visitor room
- **WHEN** a visitor connects to the visitor socket namespace with a valid chatbox `sessionId`
- **THEN** the socket joins the room for that chatbox session and channel

#### Scenario: Invalid chatbox socket is rejected
- **WHEN** a visitor connects with an expired, revoked, or unverifiable `sessionId`
- **THEN** the socket connection is rejected
