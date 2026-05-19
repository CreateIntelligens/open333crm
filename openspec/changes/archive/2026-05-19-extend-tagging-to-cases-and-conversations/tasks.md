## 1. Database Schema

- [x] 1.1 Add `caseTags CaseTag[]` to `Tag` and `tags CaseTag[]` to `Case` in `packages/database/prisma/schema.prisma`.
- [x] 1.2 Add `conversationTags ConversationTag[]` to `Tag` and `tags ConversationTag[]` to `Conversation` in `packages/database/prisma/schema.prisma`.
- [x] 1.3 Define `CaseTag` with `caseId`, `tagId`, `addedBy`, `addedById`, `addedAt`, `expiresAt`, relations to `Case` and `Tag`, `@@unique([caseId, tagId])`, target/tag indexes, and `@@map("case_tags")`.
- [x] 1.4 Define `ConversationTag` with `conversationId`, `tagId`, `addedBy`, `addedById`, `addedAt`, `expiresAt`, relations to `Conversation` and `Tag`, `@@unique([conversationId, tagId])`, target/tag indexes, and `@@map("conversation_tags")`.
- [x] 1.5 Create a Prisma migration for `case_tags` and `conversation_tags`.
- [x] 1.6 Regenerate the Prisma client and verify the generated client includes `caseTag` and `conversationTag` delegates.

## 2. Backend Tagging Service

- [x] 2.1 Add a shared API tagging service that accepts `targetType`, `targetId`, `tagId`, `tenantId`, and `agentId`.
- [x] 2.2 Implement target existence and tenant ownership checks for `CONTACT`, `CASE`, and `CONVERSATION`.
- [x] 2.3 Implement tag ownership checks so only tags from the authenticated tenant can be assigned or removed.
- [x] 2.4 Enforce `Tag.scope` compatibility with the target type before creating an assignment.
- [x] 2.5 Implement idempotent add behavior using upsert or equivalent duplicate-safe logic for all three target types.
- [x] 2.6 Implement remove behavior that deletes only the requested target/tag assignment and leaves the tag definition intact.
- [x] 2.7 Update existing contact tag add/remove behavior to call the shared tagging service without changing the public contact API contract.

## 3. Tag CRUD API

- [x] 3.1 Keep `GET /api/v1/tags`, `POST /api/v1/tags`, `PATCH /api/v1/tags/:id`, and `DELETE /api/v1/tags/:id` authenticated and tenant-scoped.
- [x] 3.2 Validate create requests for `name`, `color`, `type`, `scope`, and optional `description`.
- [x] 3.3 Return a clear conflict or validation error when a tenant creates a duplicate tag name within the same scope.
- [x] 3.4 Update tag deletion to remove contact, case, and conversation assignments in one transaction before deleting the tag.
- [x] 3.5 Ensure tag update remains limited to editable metadata and does not silently change assignment compatibility in a way that leaves invalid target assignments.

## 4. Resource Tag APIs

- [x] 4.1 Ensure `POST /api/v1/contacts/:id/tags` and `DELETE /api/v1/contacts/:id/tags/:tagId` use shared tenant and scope validation.
- [x] 4.2 Add `POST /api/v1/cases/:id/tags` and `DELETE /api/v1/cases/:id/tags/:tagId`.
- [x] 4.3 Add `POST /api/v1/conversations/:id/tags` and `DELETE /api/v1/conversations/:id/tags/:tagId`.
- [x] 4.4 Include current tag details in contact detail responses with `id`, `name`, `color`, `type`, and `scope`.
- [x] 4.5 Include current tag details in case detail responses with `id`, `name`, `color`, `type`, and `scope`.
- [x] 4.6 Include current tag details in conversation detail responses with `id`, `name`, `color`, `type`, and `scope`.
- [x] 4.7 Decide whether list responses should include tags immediately; if included, keep payloads small and avoid N+1 queries.

## 5. Frontend

- [x] 5.1 Refactor the contact-only `TagManager` into a reusable target-aware component that accepts `targetType`, `targetId`, current tags, and `onUpdate`.
- [x] 5.2 Filter selectable tags by target scope and exclude tags already assigned to the current target.
- [x] 5.3 Wire the reusable tag component into contact detail surfaces while preserving existing contact tagging behavior.
- [x] 5.4 Wire the reusable tag component into case detail surfaces for `CASE` scoped tags.
- [x] 5.5 Wire the reusable tag component into inbox or conversation detail surfaces for `CONVERSATION` scoped tags.
- [x] 5.6 Update tag management copy and delete confirmation so users understand deletion removes assignments from contacts, cases, and conversations.
- [x] 5.7 Refresh or mutate the parent view after tag add/remove so the UI shows current tags without a full page reload.

## 6. Tests and Verification

- [x] 6.1 Add backend tests for tag CRUD tenant isolation and duplicate name handling.
- [x] 6.2 Add backend tests for assigning and removing contact, case, and conversation tags.
- [x] 6.3 Add backend tests for scope mismatch rejection and cross-tenant tag rejection.
- [x] 6.4 Add backend tests proving duplicate assignment does not create duplicate rows.
- [x] 6.5 Add backend tests proving tag deletion removes assignments across all three target types.
- [x] 6.6 Add focused frontend tests or manual verification notes for target-aware tag picker filtering and add/remove flows.
- [x] 6.7 Run Prisma generation, API tests, web checks, and repository build commands required by this repo before marking the change complete.
