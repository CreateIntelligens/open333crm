## Context

`/dashboard/contacts` renders the channel column from `ContactList`. The current UI displays each `channelIdentities` item as a compact channel/provider pill, including `WEBCHAT` identities. WebChat identities are useful data for detail views and backend identity linkage, but they are not useful as high-signal channel labels in the main contacts table.

The contacts list endpoint is already paginated, but the frontend currently calls it with a fixed limit and does not render pagination controls. This change should use the contact list endpoint as the source of truth for both filtered channel identity payloads and pagination metadata.

## Goals / Non-Goals

**Goals:**

- Add a contact list filter that excludes WebChat-only contacts from list results and excludes `WEBCHAT` identities from returned contact rows.
- Have `/dashboard/contacts` call `/api/v1/contacts` with that filter.
- Add pagination state and controls to `/dashboard/contacts`.
- Preserve LINE, Facebook, WhatsApp, Email, and other non-WebChat channel provider display.

**Non-Goals:**

- No changes to contact detail pages, merge behavior, identity resolution, or channel identity storage.
- No changes to channel filter query behavior.
- No database migration.

## Decisions

1. Add an API list filter for excluding channel identities from the returned `channelIdentities` payload.

   Rationale: The dashboard should call `/api/v1/contacts` with filters instead of hiding items in the table. Applying the same exclusion to the parent contact query and included `channelIdentities` payload keeps rows, displayed identities, and pagination counts aligned.

   Alternative considered: UI-only filtering. That duplicates display policy in the table and ignores the existing contacts API filter path. Another alternative was filtering only the included identity payload, but that can leave WebChat-only contacts in the list with no useful channel signal.

2. Implement the filter as an opt-in query parameter such as `excludeChannelType=WEBCHAT`.

   Rationale: Existing `channelType` filters which contacts are returned by an included channel type. The exclusion filter has a different purpose: it removes contacts that have no remaining non-excluded identity and filters which channel identities are included in each returned contact. Keeping it opt-in avoids changing other contact list consumers.

   Alternative considered: Reuse `channelType` with a special negation syntax. That is harder to validate and less explicit than a dedicated exclusion filter.

3. Render pagination in `/dashboard/contacts` from response metadata.

   Rationale: The endpoint already returns `meta.total`, `meta.page`, `meta.limit`, and `meta.totalPages`. The page should maintain local `page` and `limit` state, reset to page 1 when search changes, and pass the current page to `useContacts`.

   Alternative considered: Continue loading a large fixed limit. That does not scale and ignores the API contract.

4. Keep `ContactList` simple and render the channel identities it receives.

   Rationale: Once `/dashboard/contacts` requests filtered data, the table does not need WebChat-specific filtering logic. A contact with only WebChat identities is excluded by the API list query.

   Alternative considered: Keep both API filtering and UI filtering. That is redundant and makes future channel policy changes harder to reason about.

## Risks / Trade-offs

- [Risk] Consumers may confuse `channelType` inclusion filtering with `excludeChannelType` exclusion filtering. -> Mitigation: Keep the query names explicit and apply the exclusion consistently to `findMany` and `count`.
- [Risk] WebChat-only contacts disappear from the dashboard contacts list. -> Mitigation: This is limited to the list request that opts into `excludeChannelType=WEBCHAT`; contact detail APIs keep WebChat identity data.
- [Risk] Pagination state can become stale after search changes. -> Mitigation: Reset page to 1 when the search query changes.
