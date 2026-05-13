## Why

Case management UI has two workflow mismatches: `/dashboard/cases` does not expose the existing delete capability and still shows a create-case entry point that should be hidden, while `/dashboard/inbox` case creation cannot reliably select an SLA policy option. These issues block routine case cleanup and prevent agents from assigning the intended SLA policy when creating a case from a conversation.

## What Changes

- Add a delete action to `/dashboard/cases` for existing cases, using the tenant-scoped case deletion API and refreshing the list after success.
- Hide the create-case button or entry point on `/dashboard/cases`.
- Fix the `/dashboard/inbox` create-case flow so the SLA policy dropdown is controlled by the selected policy id and can select available options.
- Keep case creation from inbox available; only the standalone cases page create button is hidden.
- Add focused verification for the delete action, hidden cases create button, and SLA policy select behavior.

## Capabilities

### New Capabilities

### Modified Capabilities
- `case-management`: The cases dashboard page must expose case deletion and must not expose a standalone create-case button.
- `core-inbox`: The inbox create-case flow must allow agents to select an SLA policy option and submit the selected policy id.

## Impact

- Affected app:
  - `apps/web`: cases dashboard page, case row/actions UI, inbox create-case modal/form.
- Affected API:
  - Existing case deletion API may be reused; no new route is expected unless the current frontend client lacks a wrapper.
- No Prisma schema migration is expected.
- No worker or socket routing changes are expected.
