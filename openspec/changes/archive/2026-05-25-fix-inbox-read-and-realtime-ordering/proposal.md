## Why

The inbox currently keeps unread badges after an agent opens a conversation because selecting a conversation only changes the URL and does not mark the shared conversation unread state as read. Real-time ordering also depends on refetching `/conversations` after socket events, which makes the newest conversation move late and causes avoidable API traffic.

## What Changes

- Add a team-level mark-read behavior for inbox conversations: when any agent opens a conversation, the shared `Conversation.unreadCount` is cleared for the team.
- Emit `conversation.updated` after a conversation is marked read so all online agents see the unread badge clear consistently.
- Change initial conversation list ordering to `updatedAt desc`.
- Update inbound message handling and socket payloads so realtime ordering can use updated conversation timestamps consistently.
- Update the web inbox conversation cache locally on `message.new` and `conversation.updated`, moving the affected conversation to the top without immediately refetching.
- Fallback to API revalidation only when the socket event references a conversation that is not present in the current cached list and the event payload cannot build a complete list item.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-inbox`: Inbox read-state and realtime list ordering semantics change for team-level unread clearing, initial `updatedAt desc` ordering, and socket-driven local list updates.

## Impact

- `apps/api/src/modules/conversation/conversation.service.ts`: add mark-read service behavior, update list ordering, and ensure inbound/outbound updates carry consistent timestamps.
- `apps/api/src/modules/conversation/conversation.routes.ts`: add a mark-read route for selected conversations.
- Webhook/simulator/chatbox inbound paths: ensure `conversation.updated` payloads include enough timestamp and unread state for local list ordering.
- `apps/web/src/hooks/useConversations.ts`: replace socket-triggered blind `mutate()` with SWR local cache updates and deterministic sorting.
- `apps/web/src/app/dashboard/inbox/page.tsx`: call mark-read when selecting a conversation and optimistically clear unread count.
- Tests: cover team-level unread clearing, updatedAt ordering, socket local reorder, selected-conversation unread suppression, and fallback revalidation.
