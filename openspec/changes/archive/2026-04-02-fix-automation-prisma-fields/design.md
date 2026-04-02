## Context

The automation API layer (`apps/api`) interacts with the database through Prisma. The `AutomationRule` Prisma model defines JSON fields as `conditions` and `actions`. However, the service and route handler were also writing to `conditionsJson` and `actionsJson` — field names that do not exist in the Prisma schema — causing TypeScript compilation to fail.

The `packages/automation` package has its own in-memory `AutomationRule` type (not Prisma-backed) that uses `conditionsJson`/`actionsJson` — this is a separate concern and is unaffected.

## Goals / Non-Goals

**Goals:**
- Fix TypeScript build errors by removing non-existent Prisma field assignments
- Ensure `conditions` and `actions` are the sole Prisma field names used for rule persistence

**Non-Goals:**
- Renaming fields in `packages/automation` in-memory types
- Changing Prisma schema or adding migrations
- Altering API request/response shape

## Decisions

**Remove stale field assignments, keep canonical ones**
The correct Prisma field names are `conditions` and `actions`. All references to `conditionsJson`/`actionsJson` in Prisma write operations are removed. No data mapping layer is needed since the values being written are identical.

Alternative considered: rename Prisma fields to match — rejected because it would require a migration and the canonical names (`conditions`, `actions`) are already correct and clear.

## Risks / Trade-offs

- **Risk**: Callers that send `conditionsJson`/`actionsJson` in PUT request bodies will still work, but those values are now only mapped to `conditions`/`actions` — the stale alias is dropped silently. → No mitigation needed; this was never a valid Prisma field.
