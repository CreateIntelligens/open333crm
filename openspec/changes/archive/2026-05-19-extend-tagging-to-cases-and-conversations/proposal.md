## Why

The CRM already has a shared `Tag` model with `CONTACT`, `CONVERSATION`, and `CASE` scopes, but only contacts can be tagged through the current data model and API. Cases and conversations need first-class tagging so support, automation, and marketing workflows can classify work consistently across the customer, inbox, and case layers.

## What Changes

- Add a formal tag management capability covering tag CRUD, scoped tags, and resource tagging.
- Preserve the existing shared `Tag` table as the canonical tag definition for each tenant.
- Extend tag assignment beyond contacts to cases and conversations.
- Keep Prisma-friendly explicit join tables for each tag target instead of a single polymorphic `targetType + targetId` relation table.
- Add backend APIs and service behavior for assigning, removing, and listing tags on contacts, cases, and conversations.
- Add frontend reusable tag management controls for the three supported target types.
- Ensure tag operations validate tenant ownership and tag scope before mutating assignments.

## Capabilities

### New Capabilities

- `tag-management`: Defines tenant-scoped tag CRUD and scoped tag assignment for contacts, cases, and conversations.

### Modified Capabilities

None.

## Impact

- Database schema: add case/tag and conversation/tag join models while preserving existing contact tags.
- Prisma client and migrations: regenerate database client after schema changes.
- API: extend tag routes and resource routes for case and conversation tagging.
- Web app: update settings tag CRUD and add reusable tag controls to contact, case, and conversation surfaces.
- Automation/marketing: existing contact-tag rules continue to work; case and conversation tagging becomes available through the shared service boundary.
- Tests: cover tag CRUD, scope validation, tenant isolation, duplicate assignment prevention, and resource tag API flows.
