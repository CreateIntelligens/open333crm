## MODIFIED Requirements

### Requirement: Visitor session initialization
On first load the embedded widget SHALL generate a UUID v4 `visitorToken` and persist it in `sessionStorage` key `open333crm_visitor`. Each browser tab maintains its own independent token, ensuring separate conversations per tab. The embedded widget SHALL call `POST /api/v1/webchat/:channelId/sessions` with the token to obtain a greeting message. No conversation history is fetched or displayed on load. Chatbox mode SHALL NOT use this visitor-token session contract; it SHALL use a verified `sessionId` and the chatbox session lifecycle instead.

#### Scenario: First-time visitor loads widget
- **WHEN** no `open333crm_visitor` key exists in `sessionStorage`
- **THEN** a new UUID v4 is generated, stored in `sessionStorage`, and `POST /api/v1/webchat/:channelId/sessions` is called with `{ visitorToken: "<uuid>" }`

#### Scenario: Same tab reloads widget
- **WHEN** `open333crm_visitor` key already exists in `sessionStorage`
- **THEN** the existing token is reused and `POST /api/v1/webchat/:channelId/sessions` is called

#### Scenario: Two tabs open the same widget
- **WHEN** the same embed code is loaded in two separate browser tabs
- **THEN** each tab generates its own `visitorToken`, producing two independent conversations in the inbox

#### Scenario: Session API returns greeting
- **WHEN** the channel has a `welcomeMessage` in its settings
- **THEN** the greeting message is displayed in the widget chat window on every fresh load

#### Scenario: Chatbox mode uses session id instead of visitor token
- **WHEN** a visitor opens the `/chatbox` public route
- **THEN** the chatbox client uses the verified `sessionId` lifecycle instead of creating or sending an `open333crm_visitor` token

## ADDED Requirements

### Requirement: Chatbox client does not replay server history
The chatbox client SHALL NOT request or render persisted server-side conversation history during bootstrap or refresh. It SHALL only render messages created or received during the current browser page lifetime.

#### Scenario: Chatbox refresh
- **WHEN** a visitor refreshes `/chatbox?sessionId=<valid>`
- **THEN** the client verifies the session and keeps the same server-side conversation without receiving prior persisted messages

#### Scenario: New inbound socket message
- **WHEN** an agent sends a new message after the refreshed chatbox page connects
- **THEN** the client renders that new socket message in the current page lifetime
