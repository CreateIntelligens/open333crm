## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Chatbox visitor socket authentication
The visitor Socket.IO namespace SHALL accept chatbox sessions only after verifying the `sessionId`, active Redis claim token, expiry, revocation state, channel ownership, and fingerprint policy.

#### Scenario: Valid claimed chatbox socket joins visitor room
- **WHEN** a visitor connects to the visitor socket namespace with a valid chatbox `sessionId` and matching active claim token
- **THEN** the socket joins the room for that chatbox session and channel

#### Scenario: Invalid chatbox socket is rejected
- **WHEN** a visitor connects with an expired, revoked, unverifiable, unclaimed, or claim-token-mismatched `sessionId`
- **THEN** the socket connection is rejected

## REMOVED Requirements

### Requirement: Chatbox session refresh reuses conversation
**Reason**: A public `sessionId` URL must no longer be reusable after the first successful entry, because copied links and browser refreshes must not continue the same visitor conversation.
**Migration**: Replace refresh reuse with Redis-claimed single-use entry. The active page continues to use the conversation through its non-URL claim token until the page is closed, the claim expires, or the chatbox session is revoked.

#### Scenario: Refresh with same session
- **WHEN** a visitor refreshes `/chatbox?sessionId=<valid>` after the session has already been claimed
- **THEN** the system rejects the entry and does not expose chatbox config, messages, or conversation metadata

#### Scenario: New issued session creates separate conversation
- **WHEN** a visitor receives a newly issued `sessionId`
- **THEN** the system can claim that new session independently from any previously claimed session
