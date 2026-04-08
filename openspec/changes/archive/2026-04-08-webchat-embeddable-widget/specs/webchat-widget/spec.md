## ADDED Requirements

### Requirement: Visitor session initialization
On first load the widget SHALL generate a UUID v4 `visitorToken` and persist it in `localStorage` key `open333crm_visitor`. On subsequent loads it SHALL reuse the existing token. The widget SHALL call `POST /api/v1/webchat/:channelId/sessions` with the token to obtain greeting message and recent conversation history.

#### Scenario: First-time visitor loads widget
- **WHEN** no `open333crm_visitor` key exists in `localStorage`
- **THEN** a new UUID v4 is generated, stored in `localStorage`, and `POST /api/v1/webchat/:channelId/sessions` is called with `{ visitorToken: "<uuid>" }`

#### Scenario: Returning visitor loads widget
- **WHEN** `open333crm_visitor` key already exists in `localStorage`
- **THEN** the existing token is reused and `POST /api/v1/webchat/:channelId/sessions` is called, returning up to 20 most-recent messages as history

#### Scenario: Session API returns greeting
- **WHEN** the channel has a `welcomeMessage` in its settings and the visitor is new (no prior conversation)
- **THEN** the greeting message is displayed in the widget chat window before any history

### Requirement: Visitor message sending
The widget SHALL send visitor messages via `POST /api/v1/webchat/:channelId/messages` with body `{ visitorToken, contentType: "text", content: { text } }`. The message SHALL be persisted as an INBOUND message in the database and the conversation SHALL appear in the inbox.

#### Scenario: Visitor sends a text message
- **WHEN** visitor types a message and submits
- **THEN** `POST /api/v1/webchat/:channelId/messages` is called, the message is stored in DB with `direction: INBOUND, senderType: CONTACT`, and the inbox shows the new conversation message

#### Scenario: Invalid visitorToken
- **WHEN** `visitorToken` is missing or malformed (not a UUID)
- **THEN** the API returns HTTP 400 and the widget shows a generic error

### Requirement: Real-time message delivery to visitor
The widget SHALL connect to Socket.IO namespace `/visitor` using `visitorToken` and `channelId` as auth parameters. The backend SHALL emit `agent:message` events to room `visitor:${channelId}:${visitorToken}` whenever an agent or bot sends an outbound message on a WEBCHAT conversation. Including `channelId` in the room key ensures cross-tenant isolation even if two visitors share the same UUID.

#### Scenario: Agent replies to visitor
- **WHEN** an agent sends a message in a WEBCHAT conversation
- **THEN** the visitor's widget receives an `agent:message` Socket.IO event and displays the message in real time without page reload

#### Scenario: Bot replies to visitor
- **WHEN** the bot/AI generates a reply for a WEBCHAT conversation
- **THEN** the visitor's widget receives an `agent:message` Socket.IO event and displays it

#### Scenario: Visitor Socket.IO auth fails
- **WHEN** `visitorToken` is missing or `channelId` does not exist
- **THEN** Socket.IO connection is rejected and widget falls back to polling

### Requirement: npm SDK for SPA customers
The package `@open333crm/webchat-sdk` SHALL be publishable and export a `createWebchatWidget(options)` function that returns a `WebchatWidget` instance. The SDK SHALL expose `on('message', cb)`, `send(text)`, `getHistory()`, and `destroy()`. It SHALL include TypeScript type declarations (`.d.ts`). The SDK core logic SHALL be shared with `apps/widget/` to avoid duplication.

#### Scenario: SPA developer installs SDK
- **WHEN** a developer runs `npm install @open333crm/webchat-sdk` and calls `createWebchatWidget({ channelId, apiUrl })`
- **THEN** a `WebchatWidget` instance is returned; `on('message', cb)` receives agent messages in real time and `send(text)` delivers visitor messages to the inbox

#### Scenario: TypeScript consumer gets types
- **WHEN** a TypeScript project imports from `@open333crm/webchat-sdk`
- **THEN** the IDE provides type completions for `WebchatWidget` methods and `Message` type without any `@ts-ignore`

The API SHALL serve the compiled widget JS bundle at `GET /webchat/widget.js` as a static file. The existing embed code generator SHALL produce a `<script>` tag pointing to this URL. The widget SHALL attach a launcher button to the host page without conflicting with the page's own JS.

#### Scenario: Customer installs embed code
- **WHEN** the embed `<script>` tag is added to a webpage
- **THEN** the widget JS loads, a chat launcher button appears in the bottom-right corner, and no JS errors are thrown on the host page

#### Scenario: Widget bundle served correctly
- **WHEN** `GET /webchat/widget.js` is requested
- **THEN** the server responds with `Content-Type: application/javascript` and the IIFE bundle content
