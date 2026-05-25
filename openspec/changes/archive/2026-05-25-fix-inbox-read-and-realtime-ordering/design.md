## Context

The current inbox list is loaded through `useConversations`, which fetches `/conversations` and refetches the whole list when `message.new` or `conversation.updated` socket events arrive. The API currently sorts conversations by `lastMessageAt desc`, while the requested behavior is initial loading by `updatedAt desc`. Selecting a conversation only updates the `/dashboard/inbox?conv=...` URL; it does not call a backend read endpoint or clear `Conversation.unreadCount`.

The product decision is to keep unread state team-level for now. If one agent opens a conversation, that conversation is considered read for the shared team inbox and other agents should also see its unread badge disappear.

## Goals / Non-Goals

**Goals:**

- Mark a conversation read when an agent opens it in `/dashboard/inbox`.
- Keep unread state conversation-level/team-level rather than per-agent.
- Sort initial conversation list results by `updatedAt desc`.
- Move updated conversations to the top locally when socket events arrive, without immediately refetching the list.
- Keep API fallback only for cache misses where the socket payload cannot construct a complete list item.

**Non-Goals:**

- Do not introduce per-agent read state, `lastReadAt`, or per-agent unread counts.
- Do not change notification bell unread semantics.
- Do not require workers for direct inbox message updates emitted inside the API process.
- Do not remove SWR revalidation entirely; it remains the fallback and explicit refresh mechanism.

## Decisions

1. Keep unread as a team-level `Conversation.unreadCount`.

   This matches the current schema and the user's confirmed understanding: if customer service agent A reads the conversation, agent B should also no longer see the unread badge. A per-agent read table would solve a different product requirement and would add schema and UI complexity that is not needed for this change.

2. Add a mark-read endpoint for conversation selection.

   The inbox page should call a dedicated route such as `POST /api/v1/conversations/:id/read` after selecting a conversation. The backend sets `unreadCount` to 0 for that tenant-owned conversation and emits `conversation.updated` to the conversation and tenant rooms. This keeps DB state authoritative while allowing the frontend to optimistically clear the badge immediately.

3. Use `updatedAt desc` for initial conversation list ordering.

   `listConversations` should order by `updatedAt desc` so initial render matches the requested sort. Message ingestion and mark-read operations both update the conversation row, so the list order remains based on the latest meaningful conversation activity/read update.

4. Prefer local SWR cache updates on socket events.

   `useConversations` should merge `message.new` and `conversation.updated` into the cached list instead of always calling `mutate()` with a refetch. For a cached conversation, the hook can update `lastMessage`, `unreadCount`, `updatedAt`, `lastMessageAt`, status, and assignment fields, then sort the array by `updatedAt desc`.

5. Fallback only when the socket payload cannot represent a missing list item.

   Existing socket payloads often include only partial conversation fields. If the event refers to a conversation that is not already in the current SWR cache and the payload lacks contact/channel/list item data, the hook should revalidate through the API. If later payloads are expanded to include full list-item shape, that fallback can be removed.

## Risks / Trade-offs

- Shared unread clearing may surprise teams that expect personal unread state -> This is an explicit team-level product choice; per-agent read state remains out of scope.
- Local cache merge can drift from server truth -> Keep fallback revalidation for cache misses and retain explicit SWR mutate access for manual refresh paths.
- `updatedAt` changes on mark-read may move a read conversation to the top -> This follows the requested `updatedAt desc` ordering. If that feels noisy in practice, a later change can separate read timestamp from list ordering.
- Socket payloads are inconsistent across emitters -> Normalize handling in `useConversations` and add tests/source checks for webhook, simulator, and conversation service payloads.

## Migration Plan

1. Add backend mark-read service and route.
2. Change conversation list ordering to `updatedAt desc`.
3. Ensure emitted `conversation.updated` payloads include `updatedAt`, `lastMessageAt`, and `unreadCount`.
4. Update `useConversations` to locally merge/reorder cached conversations on socket events.
5. Update inbox selection to optimistically clear unread count and call mark-read.
6. Add focused tests or source checks for backend read behavior and frontend socket cache behavior.

## Open Questions

None.
