## Context

Open333CRM already has a tenant-scoped `Tag` model with `TagScope` values for contacts, conversations, and cases. The implemented assignment model only covers contacts through `ContactTag`, and the current tag deletion path only removes `contact_tags` before deleting a tag.

The next step is to make tagging a first-class cross-resource capability without losing Prisma type safety. Contacts, cases, and conversations should all use the same tag definition table, but each target type should keep a concrete join table and relation so PostgreSQL foreign keys, cascade behavior, nested Prisma queries, and tenant checks remain straightforward.

## Goals / Non-Goals

**Goals:**

- Support tag CRUD for tenant-owned tags across `CONTACT`, `CASE`, and `CONVERSATION` scopes.
- Support assigning, removing, and reading tags on contacts, cases, and conversations.
- Reuse one service boundary for tagging behavior so API routes and future automation actions do not duplicate validation rules.
- Preserve existing contact tagging behavior while adding case and conversation targets.
- Make the frontend tag UI reusable by target type.
- Keep tenant isolation and tag scope validation explicit.

**Non-Goals:**

- Do not implement a generic polymorphic `targetType + targetId` database relation table.
- Do not change existing contact merge semantics beyond preserving existing contact tags.
- Do not add new automation actions for case or conversation tagging in this change.
- Do not change campaign audience behavior beyond keeping existing contact-tag filters working.
- Do not introduce new realtime worker flows; tag mutations from HTTP requests can emit directly from the API process when UI revalidation needs it.

## Decisions

### Use explicit join tables per tag target

Add `CaseTag` and `ConversationTag` models beside the existing `ContactTag` model.

```text
Tag
├── ContactTag       -> Contact
├── CaseTag          -> Case
└── ConversationTag  -> Conversation
```

Rationale: Prisma does not model a single relation field that can point to multiple target models. Explicit join tables preserve generated relation APIs, foreign keys, unique constraints, indexes, and cascade deletes.

Alternative considered: a single `TagBinding(tagId, targetType, targetId)` table. This is more compact but makes `targetId` an untyped scalar, loses database-enforced target existence, and requires manual cleanup or triggers when targets are deleted.

### Keep `Tag.scope` as the target compatibility contract

`Tag.scope` determines where a tag can be applied:

- `CONTACT` tags can only be assigned to contacts.
- `CASE` tags can only be assigned to cases.
- `CONVERSATION` tags can only be assigned to conversations.

Rationale: the enum already exists and is exposed in the current settings UI. Enforcing it in the service layer avoids accidental use of a case-only tag on a contact.

Alternative considered: allow tags to be reusable across all targets. That makes the UI simpler but weakens reporting and makes names like "VIP" ambiguous when the same label has different operational meaning per resource.

### Centralize mutation rules in a tagging service

Introduce an API-side tagging service with operations such as:

```ts
addTag({ tenantId, targetType, targetId, tagId, addedById })
removeTag({ tenantId, targetType, targetId, tagId })
listTargetTags({ tenantId, targetType, targetId })
```

The service owns target existence checks, tenant checks, tag ownership checks, scope validation, and idempotent assignment.

Rationale: contact, case, and conversation routes need the same safety rules. Keeping them in one service prevents inconsistent validation across modules.

Alternative considered: implement each route directly in its existing module service. That is faster initially but increases drift risk as case and conversation tagging evolve.

### Prefer resource routes for external API shape

Keep the current contact route style and add matching routes:

```http
POST   /api/v1/contacts/:id/tags
DELETE /api/v1/contacts/:id/tags/:tagId

POST   /api/v1/cases/:id/tags
DELETE /api/v1/cases/:id/tags/:tagId

POST   /api/v1/conversations/:id/tags
DELETE /api/v1/conversations/:id/tags/:tagId
```

Rationale: these endpoints are easy to discover from the resource being tagged, match the existing contact API, and keep route-level authorization context clear.

Alternative considered: add only a generic `/api/v1/tags/bindings` endpoint. That is convenient for a shared frontend component, but the backend can still offer a shared service while keeping resource URLs readable.

### Reuse and generalize frontend tag controls

Refactor the existing contact-only `TagManager` into a target-aware component that accepts `targetType`, `targetId`, current tags, and an update callback. The component filters available tags by `scope` and calls the correct resource endpoint.

Rationale: the contact detail, case detail, and inbox conversation panels should present the same tag behavior without duplicating request code.

Alternative considered: create separate contact, case, and conversation components. That would duplicate UI states and make future changes slower.

## Risks / Trade-offs

- [Risk] Existing tag deletion only removes contact assignments. → Mitigation: update deletion to remove contact, case, and conversation assignments in one transaction before deleting the tag.
- [Risk] A tag can be created with the same name and different scope, confusing users. → Mitigation: keep the existing unique key on tenant/name/scope and show scope clearly in the settings UI and target tag picker.
- [Risk] Contact-only code assumes every tag relation is `contactTags`. → Mitigation: keep existing contact relation names intact and add new relation names for cases and conversations instead of renaming contact fields.
- [Risk] Frontend lists may show stale tags after mutation. → Mitigation: use the existing refresh/SWR mutation pattern from the parent surface after add/remove.
- [Risk] Tenant isolation bugs could allow applying another tenant's tag. → Mitigation: every service operation must check both target tenant and tag tenant before creating or deleting an assignment.

## Migration Plan

1. Add `case_tags` and `conversation_tags` tables through Prisma migration.
2. Add indexes and unique constraints for each target/tag pair.
3. Regenerate Prisma client.
4. Implement tagging service and update existing contact tag routes to use it.
5. Add case and conversation tag routes.
6. Update response includes for case and conversation detail APIs so current tags are available to the frontend.
7. Refactor the frontend tag manager to support all target types and wire it into contact, case, and conversation surfaces.
8. Update tag delete behavior to remove all assignments for the tag in a transaction.

Rollback strategy: dropping the new join tables removes case and conversation assignments without affecting existing contact tags or tag definitions.

## Open Questions

- Should case and conversation tag changes create timeline/event records immediately, or should that be a follow-up audit-log change?
- Should list endpoints support filtering cases/conversations by tag in this change, or should that be separate from first-class assignment CRUD?
