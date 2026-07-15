## Why

The contacts dashboard channel column is meant to help operators identify customer-facing messaging providers at a glance. WebChat identities are internal website session identities and add noise in this list, especially when a contact also has LINE or Facebook identities.

## What Changes

- Add a `/api/v1/contacts` filter that can omit `WEBCHAT` identities from the returned list payload.
- Call `/api/v1/contacts` from `/dashboard/contacts` with the WebChat-exclusion filter instead of hiding WebChat in table rendering.
- Keep contacts with at least one non-WebChat identity visible in the contacts list.
- Remove WebChat-only contacts from the contacts list response when the exclusion filter is active.
- Keep WebChat identities available in API payloads and contact detail views; this is display-only filtering for the contacts list.
- Preserve non-WebChat channel display, including provider type and provider name when available.
- Add visible pagination controls to `/dashboard/contacts` using the existing paginated `/api/v1/contacts` response metadata.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `contact-management`: The contacts dashboard list requests filtered contact list data that excludes WebChat-only contacts and WebChat channel identities, preserves non-WebChat provider display, and exposes pagination controls.

## Impact

- API: `apps/api/src/modules/contact/contact.routes.ts` and `apps/api/src/modules/contact/contact.service.ts` contact list filters.
- Web: `apps/web/src/hooks/useContacts.ts`, `apps/web/src/app/dashboard/contacts/page.tsx`, and `apps/web/src/components/contact/ContactList.tsx` assumptions about pre-filtered identities.
- Tests/validation: focused API contact list filter coverage, `pnpm --filter @open333crm/web exec tsc --noEmit`, and `openspec validate hide-webchat-contact-channel --strict`.
- No database schema, migration, worker, or socket changes are expected.
