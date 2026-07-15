## 1. API Contact Filters

- [x] 1.1 Add an opt-in contact list query filter for excluding a channel type from returned `channelIdentities`.
- [x] 1.2 Update `listContacts` so `excludeChannelType=WEBCHAT` removes WebChat identities from each returned contact while keeping contact rows and pagination counts unchanged.
- [x] 1.3 Add or update focused API coverage for the excluded channel identity payload shape.

## 2. Contacts Dashboard Request

- [x] 2.1 Update `useContacts` to pass supported `/api/v1/contacts` filters (`tagId`, `channelType`, `excludeChannelType`, `page`, `limit`) using API parameter names.
- [x] 2.2 Update `/dashboard/contacts` to request contacts with `excludeChannelType=WEBCHAT`.
- [x] 2.3 Verify `ContactList` remains API-driven and has no WebChat-specific filtering for this change.

## 3. Contacts Dashboard Pagination

- [x] 3.1 Add page and limit state to `/dashboard/contacts`.
- [x] 3.2 Render pagination controls from `meta.total`, `meta.page`, `meta.limit`, and `meta.totalPages`.
- [x] 3.3 Reset page to 1 when the search query changes.

## 4. Validation

- [x] 4.1 Run focused API contact service test coverage.
- [x] 4.2 Run `pnpm --filter @open333crm/web exec tsc --noEmit`.
- [x] 4.3 Run `openspec validate hide-webchat-contact-channel --strict`.
