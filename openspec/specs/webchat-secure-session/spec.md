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

### Requirement: Chatbox session entry is claimed in Redis
The system SHALL create a Redis claim record when a visitor successfully enters a standalone chatbox with a valid `sessionId`. The claim key SHALL be derived from non-raw session material, SHALL be created atomically only if absent, and SHALL expire with a TTL equal to the remaining lifetime of the chatbox session.

#### Scenario: First entry claims session
- **WHEN** a visitor opens `/chatbox?sessionId=<valid>` and no Redis claim exists for that chatbox session
- **THEN** the system stores a Redis claim with a TTL matching the session's remaining `expiresAt` duration and returns the public chatbox config

#### Scenario: Claim TTL follows session TTL
- **WHEN** a chatbox session expires in 30 minutes at the moment it is claimed
- **THEN** the Redis claim expires in 30 minutes and does not outlive the database-backed chatbox session

#### Scenario: Raw session id is not stored in Redis
- **WHEN** the system writes the Redis claim
- **THEN** the Redis key and value do not contain the raw public `sessionId`

### Requirement: Chatbox active page uses a non-URL claim token
The system SHALL return a page-lifetime claim token only after a successful Redis claim. The chatbox client SHALL keep the token in memory only and SHALL send it with chatbox message, media, and visitor socket requests. The token SHALL NOT be written to the URL, localStorage, or sessionStorage.

#### Scenario: Claimed page sends a message
- **WHEN** the active chatbox page submits a message with the original `sessionId` and matching claim token
- **THEN** the system accepts the request after normal session, expiry, revocation, fingerprint, and claim checks pass

#### Scenario: Claimed page uploads media
- **WHEN** the active chatbox page uploads media with the original `sessionId` and matching claim token
- **THEN** the system accepts the upload after normal session, expiry, revocation, fingerprint, and claim checks pass

#### Scenario: Claim token is not persisted by client
- **WHEN** the chatbox page receives a claim token
- **THEN** the client keeps it only in page memory and does not include it in the browser address bar or persistent browser storage

### Requirement: Claimed chatbox sessions cannot be reused by URL
The system SHALL reject a standalone chatbox entry when the submitted `sessionId` already has an active Redis claim. A claimed `sessionId` SHALL NOT allow copied links or browser refreshes to expose chatbox config, messages, or conversation metadata.

#### Scenario: Refresh with same session
- **WHEN** a visitor refreshes `/chatbox?sessionId=<valid>` after the session has already been claimed
- **THEN** the system rejects the entry and does not expose chatbox config, messages, or conversation metadata

#### Scenario: New issued session creates separate conversation
- **WHEN** a visitor receives a newly issued `sessionId`
- **THEN** the system can claim that new session independently from any previously claimed session

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
The visitor Socket.IO namespace SHALL accept chatbox sessions only after verifying the `sessionId`, active Redis claim token, expiry, revocation state, channel ownership, and fingerprint policy.

#### Scenario: Valid claimed chatbox socket joins visitor room
- **WHEN** a visitor connects to the visitor socket namespace with a valid chatbox `sessionId` and matching active claim token
- **THEN** the socket joins the room for that chatbox session and channel

#### Scenario: Invalid chatbox socket is rejected
- **WHEN** a visitor connects with an expired, revoked, unverifiable, unclaimed, or claim-token-mismatched `sessionId`
- **THEN** the socket connection is rejected
