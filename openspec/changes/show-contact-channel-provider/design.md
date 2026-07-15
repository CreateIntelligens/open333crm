## Context

`/dashboard/contacts` renders `ContactList`, which currently reads `channelIdentities` from `GET /api/v1/contacts` and shows only `channelType` through `ChannelBadge`. The list API selects `id`, `channelType`, `uid`, and `profileName` from `ChannelIdentity`, while the contact detail API already includes the related `channel` with `displayName` and `channelType`.

Tenants can connect multiple providers of the same channel type. A contact with a LINE identity from one official account and another contact with a LINE identity from a different official account both appear as only `LINE`, so operators cannot tell which provider account produced the identity from the list view.

## Goals / Non-Goals

**Goals:**

- Include provider channel metadata for each contact list channel identity.
- Display both provider type and provider name in the `/dashboard/contacts` channel column.
- Keep the response tenant-scoped through the existing contact query and Prisma relation.
- Preserve current pagination, search, tag rendering, click-through navigation, and detail-page compatibility.

**Non-Goals:**

- No database schema migration.
- No new provider registry or channel settings model.
- No change to contact merge semantics or identity resolution.
- No change to the existing `channelType` filter behavior.

## Decisions

1. Enrich list API payload by including the related `channel` in `listContacts`.

   Rationale: `ChannelIdentity` already has a required `channelId` relation to `Channel`, and the detail API already uses this relation. Selecting `channel.id`, `channel.displayName`, and `channel.channelType` keeps the UI aligned with persisted provider metadata without duplicating display names onto identities.

   Alternative considered: Make the web app call `/channels` and join names client-side. That adds an extra request, introduces stale join logic in the browser, and forces the list to understand channel authorization details already owned by the API.

2. Treat provider type as the identity/channel type, and provider name as `channel.displayName`.

   Rationale: The current data model has `Channel.channelType` as provider type and `Channel.displayName` as the operator-facing provider name. For consistency and backward compatibility, `channelIdentities[].channelType` remains available and should match `channel.channelType`.

   Alternative considered: Add new flattened fields such as `providerType` and `providerName`. That would be convenient for the table, but it creates another API shape to keep in sync. The nested `channel` shape is already used by the detail API.

3. Render compact channel provider pills in `ContactList`.

   Rationale: The contacts table is scan-oriented. Each identity should show the familiar channel badge plus the provider display name, while falling back to the existing channel type-only badge if channel metadata is missing during partial responses or older deployments.

   Alternative considered: Add a separate provider-name column. That would widen the table and split related information. Keeping provider type and name in the existing channel column matches the user's request and avoids layout churn.

## Risks / Trade-offs

- [Risk] Contacts with many channel identities may make the channel column taller. -> Mitigation: Use compact wrapping pills and keep existing table overflow behavior.
- [Risk] A malformed or historical identity may not have a resolvable channel relation. -> Mitigation: Render the existing `channelType` badge and omit the provider name for that identity.
- [Risk] The enriched include increases payload size for contact lists. -> Mitigation: Select only `id`, `displayName`, and `channelType` from `channel`, not credentials, settings, webhook URLs, or other sensitive fields.
- [Risk] Frontend assumptions about `channelIdentities` may diverge between list and detail views. -> Mitigation: Define a shared local shape or compatible inline type that accepts optional nested `channel` metadata in list rendering.
