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

### Requirement: Inbox Case Creation SLA Policy Selection
The inbox create-case modal SHALL allow a user to select an SLA policy from the available policy options. The selected option SHALL remain visibly selected in the dropdown and the selected policy id SHALL be included in the case creation request when present.

#### Scenario: Select SLA policy option
- **WHEN** a user opens the create-case modal from `/dashboard/inbox` and selects an SLA policy option
- **THEN** the dropdown displays the selected option instead of reverting to the default option

#### Scenario: Submit selected SLA policy
- **WHEN** a user submits the create-case modal after selecting an SLA policy
- **THEN** the create-case request includes the selected SLA policy id

#### Scenario: Use automatic SLA policy
- **WHEN** a user leaves the SLA policy dropdown on the default automatic option
- **THEN** the create-case request omits the explicit SLA policy id and allows backend priority-based policy selection

### Requirement: Team-level conversation read state
The inbox SHALL treat `Conversation.unreadCount` as a shared team-level unread state. When any authenticated agent opens a tenant-owned conversation from the inbox, the system SHALL mark that conversation read by clearing its `unreadCount` for all agents in the tenant.

#### Scenario: Agent opens unread conversation
- **WHEN** an authenticated agent selects a conversation in `/dashboard/inbox` and the conversation has `unreadCount` greater than 0
- **THEN** the frontend clears that conversation's unread badge optimistically and the backend persists `unreadCount` as 0

#### Scenario: Other agents observe cleared unread state
- **WHEN** agent A marks a conversation read
- **THEN** agent B receives or observes the same conversation with `unreadCount` 0

#### Scenario: Mark read emits conversation update
- **WHEN** the backend clears a conversation's unread count
- **THEN** it emits `conversation.updated` to the conversation room and tenant room with `id`, `unreadCount`, `updatedAt`, and `lastMessageAt`

### Requirement: Inbox initial ordering uses updatedAt
The conversation list API SHALL order initial inbox conversation results by `updatedAt` descending unless a future explicit sort option overrides it.

#### Scenario: Initial inbox load
- **WHEN** the inbox requests `/api/v1/conversations`
- **THEN** the returned conversations are ordered from newest `updatedAt` to oldest `updatedAt`

#### Scenario: Pagination respects updatedAt order
- **WHEN** the inbox requests subsequent pages of conversations
- **THEN** pagination is based on the same `updatedAt desc` ordering

### Requirement: Inbox socket updates reorder locally
The web inbox SHALL update its cached conversation list locally when `message.new` or `conversation.updated` socket events arrive. For conversations already present in the current cache, the frontend SHALL merge the socket payload into that row and reorder the cached list by `updatedAt desc` without immediately refetching `/conversations`.

#### Scenario: Existing conversation receives new message
- **WHEN** the web client receives `message.new` for a conversation already present in the cached list
- **THEN** it updates that row's `lastMessage`, timestamp fields, and unread count according to the event context, then moves the conversation to the top according to `updatedAt desc`

#### Scenario: Existing conversation receives update
- **WHEN** the web client receives `conversation.updated` for a conversation already present in the cached list
- **THEN** it merges updated status, assignee, unread count, `updatedAt`, and `lastMessageAt` into the row and re-sorts the cached list by `updatedAt desc`

#### Scenario: Selected conversation receives inbound message
- **WHEN** the currently selected conversation receives an inbound `message.new` event
- **THEN** the web client keeps that conversation's displayed unread count at 0 and may call the mark-read endpoint to persist the team-level read state

#### Scenario: Missing conversation cannot be built from socket payload
- **WHEN** a socket event references a conversation that is not present in the cached list and the payload lacks the fields needed to render a full list item
- **THEN** the web client revalidates `/conversations` through SWR as a fallback
