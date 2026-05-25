## ADDED Requirements

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
