## 1. Backend Read State

- [x] 1.1 Add a conversation mark-read service function that verifies tenant ownership and sets `unreadCount` to 0.
- [x] 1.2 Add `POST /api/v1/conversations/:id/read` that calls the mark-read service for authenticated agents.
- [x] 1.3 Emit `conversation.updated` to both `conversation:<id>` and `tenant:<tenantId>` after mark-read with `id`, `unreadCount`, `updatedAt`, and `lastMessageAt`.
- [x] 1.4 Preserve team-level unread semantics; do not add per-agent read state or schema changes.

## 2. Backend Ordering And Socket Payloads

- [x] 2.1 Change `listConversations` default ordering from `lastMessageAt desc` to `updatedAt desc`.
- [x] 2.2 Ensure inbound message paths update the conversation row timestamp used for `updatedAt desc` ordering.
- [x] 2.3 Ensure `conversation.updated` payloads from webhook, simulator, conversation update, close, handoff, and mark-read paths include `updatedAt`.
- [x] 2.4 Ensure `message.new` payloads include enough message data for the frontend to update `lastMessage` locally.

## 3. Frontend Inbox Behavior

- [x] 3.1 Update inbox conversation selection to optimistically clear the selected row's `unreadCount` and call the mark-read route.
- [x] 3.2 Update `useConversations` to merge `conversation.updated` events into cached rows and sort by `updatedAt desc` without immediate API refetch.
- [x] 3.3 Update `useConversations` to merge `message.new` events into cached rows, update `lastMessage`, apply unread behavior, and sort by `updatedAt desc`.
- [x] 3.4 Keep the selected conversation unread count at 0 when its own inbound socket message arrives, and persist read state through the mark-read route.
- [x] 3.5 Retain API revalidation fallback when a socket event references a conversation missing from the current cache and payload cannot build a full list item.

## 4. Tests And Verification

- [x] 4.1 Add backend tests or focused source checks for mark-read route/service behavior and team-level unread clearing.
- [x] 4.2 Add backend tests or source checks proving conversation list ordering uses `updatedAt desc`.
- [x] 4.3 Add frontend tests or source checks for socket-driven local reorder and no blind mutate on every event.
- [x] 4.4 Verify `/dashboard/inbox` behavior manually or with focused checks: click unread conversation clears badge, inbound socket moves conversation to top, selected conversation stays read.
- [x] 4.5 Run relevant API and web type/build checks.
