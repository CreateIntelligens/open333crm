## ADDED Requirements

### Requirement: Real-time WebSocket Broadcasting
The system SHALL push new messages to connected frontend clients in real-time through the authoritative API bootstrap rooted at `apps/api/src/index.ts`.

#### Scenario: Pushing to online agent
- **WHEN** a new message is saved to an active conversation
- **THEN** the system pushes a WebSocket event `message.created` to clients subscribed to that conversation using the server initialized from `apps/api/src/index.ts`

---

### Requirement: Cross-Process WebSocket Event Emission via Redis Pub/Sub
When WebSocket events are emitted from within the API process, the existing `io.to(room).emit(event, data)` call path SHALL remain unchanged.

When WebSocket events need to be emitted from **outside the API process** (e.g., from standalone worker handlers), the emitting process SHALL NOT import or directly connect to the API's Socket.IO server. Instead, it SHALL publish a JSON-serialized message to the Redis pub/sub channel `socket:emit` with the shape:

```ts
{
  room: string;   // Socket.IO room name, e.g. "conversation:42" or "user:7"
  event: string;  // Socket.IO event name, e.g. "notification:new"
  data: unknown;  // Arbitrary serializable payload
}
```

The API process SHALL subscribe to the `socket:emit` Redis channel at startup (inside the socket plugin initialization) and, upon receiving a valid message, forward it to the Socket.IO server using `io.to(room).emit(event, data)`.

This bridge enables any Node.js process with Redis access to trigger real-time client updates without coupling to the API's internal Socket.IO instance.

#### Scenario: Standalone worker emits a real-time notification
- **WHEN** the standalone notification worker processes a job and needs to notify a connected user
- **THEN** the worker publishes `{ room: "user:7", event: "notification:new", data: { ... } }` to the `socket:emit` Redis channel, the API subscriber receives it, and calls `io.to("user:7").emit("notification:new", { ... })`

#### Scenario: Standalone worker emits a conversation update
- **WHEN** the standalone automation worker updates a conversation's status
- **THEN** the worker publishes `{ room: "conversation:42", event: "conversation:updated", data: { ... } }` to `socket:emit`, and the API forwards it to all clients subscribed to that conversation room

#### Scenario: Malformed message received on socket:emit channel
- **WHEN** the API's Redis subscriber receives a message on `socket:emit` that cannot be parsed as JSON or is missing required fields (`room`, `event`)
- **THEN** the API logs a warning with the raw message content and discards it without calling `io.emit`

#### Scenario: API process starts before Redis is available
- **WHEN** the API attempts to subscribe to `socket:emit` during socket plugin initialization but Redis is not yet ready
- **THEN** the socket plugin initialization fails fast, the API logs an error, and does not start accepting connections until Redis is available (consistent with existing Redis dependency behavior)

### Requirement: Conversation Route Access Is Open to All Authenticated Roles
Conversation and message routes SHALL allow access for all authenticated roles: `AGENT`, `SUPERVISOR`, and `ADMIN`. No RBAC guard restricting conversation access by role SHALL be introduced in this change.

Data-level filtering — such as restricting an AGENT to only their own assigned conversations — is explicitly deferred to a future change and is outside the scope of this RBAC guard rollout.

#### Scenario: AGENT accesses conversation routes
- **GIVEN** a request is authenticated with role `AGENT`
- **WHEN** any conversation or message route is called (e.g., `GET /conversations`, `GET /conversations/:id/messages`)
- **THEN** the request SHALL reach the route handler without a 403 response from an RBAC guard

#### Scenario: SUPERVISOR accesses conversation routes
- **GIVEN** a request is authenticated with role `SUPERVISOR`
- **WHEN** any conversation or message route is called
- **THEN** the request SHALL reach the route handler

#### Scenario: ADMIN accesses conversation routes
- **GIVEN** a request is authenticated with role `ADMIN`
- **WHEN** any conversation or message route is called
- **THEN** the request SHALL reach the route handler

### Requirement: Inbox Page Conversation Data Fetching
`InboxPage` SHALL use `useSWR` (keyed by `/conversations/:id`) to fetch the selected conversation's details, so that any `globalMutate('/conversations/:id')` call from child components immediately triggers a revalidation and re-render with the latest data.

#### Scenario: Handoff to human agent unlocks message input
- **WHEN** an agent clicks the takeover button and `handleTakeover()` completes successfully
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation in `InboxPage`, the `conversation.status` prop updates to a non-`BOT_HANDLED` value, `isBotHandled` becomes `false`, and the message input box becomes enabled

#### Scenario: Status change reflects immediately in Select
- **WHEN** an agent selects a new status from the status `Select` dropdown and `handleStatusChange()` completes
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation, `conversation.status` updates, and the status `Select` displays the newly selected value

#### Scenario: Agent assignment reflects immediately in Select
- **WHEN** an agent selects a new assignee from the agent `Select` dropdown and `handleAssign()` completes
- **THEN** `globalMutate('/conversations/:id')` triggers SWR revalidation, `conversation.assignedToId` updates, and the agent `Select` displays the newly assigned agent

#### Scenario: No conversation selected
- **WHEN** `convId` is null (no conversation selected)
- **THEN** SWR SHALL NOT issue any API request (null key pattern), and `selectedConversation` SHALL be null

---

### Requirement: Inbox message input respects IME composition
The inbox message input SHALL NOT submit a message when the Enter key is pressed while IME composition is active. Enter submission SHALL only occur after composition ends, while Shift+Enter continues to insert a newline.

#### Scenario: Agent is choosing a Chinese candidate
- **WHEN** the agent presses Enter to confirm an IME candidate in the inbox textarea
- **THEN** the message is not sent and the textarea remains editable

#### Scenario: Agent inserts a newline
- **WHEN** the agent presses Shift+Enter in the inbox textarea
- **THEN** the textarea inserts a newline instead of sending the message

#### Scenario: Agent sends after composition completes
- **WHEN** IME composition has ended and the agent presses Enter without Shift
- **THEN** the current message is submitted once
