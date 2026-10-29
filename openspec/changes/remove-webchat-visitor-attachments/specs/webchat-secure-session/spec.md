## MODIFIED Requirements

### Requirement: Chatbox active page uses a non-URL claim token
The system SHALL return a page-lifetime claim token only after a successful Redis claim. The chatbox client SHALL keep the token in memory only and SHALL send it with chatbox message and visitor socket requests. The token SHALL NOT be written to the URL, localStorage, or sessionStorage.

#### Scenario: Claimed page sends a message
- **WHEN** the active chatbox page submits a message with the original `sessionId` and matching claim token
- **THEN** the system accepts the request after normal session, expiry, revocation, fingerprint, and claim checks pass

#### Scenario: Claimed page uploads media
- **WHEN** a client posts a file to `POST /api/v1/chatbox/media` with the original `sessionId` and matching claim token
- **THEN** the system returns 410 `WEBCHAT_VISITOR_MEDIA_DISABLED` and does not store the file

#### Scenario: Claim token is not persisted by client
- **WHEN** the chatbox page receives a claim token
- **THEN** the client keeps it only in page memory and does not include it in the browser address bar or persistent browser storage
