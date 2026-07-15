## Why

The contacts dashboard currently shows only channel type badges, so operators cannot distinguish contacts that come from different providers of the same channel type. This becomes ambiguous when a tenant has multiple LINE, Facebook, or WebChat channels connected.

## What Changes

- Extend contact list channel identity data so each identity includes its provider channel metadata.
- Update `/dashboard/contacts` to show both the provider type and provider name in the channel column.
- Preserve existing contact filtering, pagination, row navigation, and empty-state behavior.
- Keep the detail page behavior compatible with the enriched channel identity shape.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `contact-management`: Contact list results and the contacts dashboard channel column expose provider type and provider display name for each contact channel identity.

## Impact

- API: `apps/api/src/modules/contact/contact.service.ts` list query payload for `GET /api/v1/contacts`.
- Web: `apps/web/src/app/dashboard/contacts/page.tsx`, `apps/web/src/components/contact/ContactList.tsx`, and contact type assumptions around `channelIdentities`.
- Tests/validation: focused API contact list coverage if available, web typecheck via `pnpm --filter @open333crm/web exec tsc --noEmit`, and relevant API tests for contact payload shape.
