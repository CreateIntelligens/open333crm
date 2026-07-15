## 1. API Payload

- [x] 1.1 Update `listContacts` in `apps/api/src/modules/contact/contact.service.ts` to include each channel identity's related `channel` with only `id`, `displayName`, and `channelType`.
- [x] 1.2 Ensure the `GET /api/v1/contacts` response remains tenant-scoped and does not expose channel credentials, settings, webhook URLs, or other sensitive channel fields.
- [x] 1.3 Add or update focused API coverage for contact list channel identity metadata if an existing contact route/service test harness is present.

## 2. Contacts Dashboard UI

- [x] 2.1 Update `ContactList` channel identity typing to accept optional nested provider channel metadata.
- [x] 2.2 Render each channel identity in `/dashboard/contacts` with provider type and provider display name in the existing channel column.
- [x] 2.3 Preserve fallback rendering for identities that only provide `channelType`.
- [x] 2.4 Keep row navigation, empty state, tags, and date formatting behavior unchanged.

## 3. Validation

- [x] 3.1 Run the focused API test or a practical service/route smoke test for `GET /api/v1/contacts`.
- [x] 3.2 Run `pnpm --filter @open333crm/web exec tsc --noEmit`.
- [x] 3.3 Run `openspec validate show-contact-channel-provider --strict`.
