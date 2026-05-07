## 1. Data Model

- [x] 1.1 Update the Prisma Case/Conversation relationship so one Case can have multiple linked Conversations while each Conversation still has at most one Case.
- [x] 1.2 Add and review the required Prisma migration for removing the one-to-one uniqueness constraint and preserving existing links.
- [x] 1.3 Regenerate the Prisma client and update TypeScript relation names/selects impacted by the schema change.

## 2. Case API Completion

- [x] 2.1 Implement tenant-scoped `DELETE /api/v1/cases/:id` in `apps/api/src/modules/case/case.routes.ts`.
- [x] 2.2 Implement a `deleteCase` service function that unlinks related Conversations, deletes the Case through Prisma, and emits `case.deleted` to the tenant room.
- [x] 2.3 Ensure delete returns not found for missing or cross-tenant Case ids and does not mutate other tenants' data.

## 3. Conversation Linking

- [x] 3.1 Make `createCaseFromConversation` transactional so Case creation and Conversation linking succeed or fail together.
- [x] 3.2 Preserve `409 CONFLICT` behavior when creating a Case from a Conversation that already has a linked Case.
- [x] 3.3 Add an API/service path to link an unlinked Conversation to an existing Case in the same tenant.
- [x] 3.4 Update Case detail retrieval so linked Conversations are exposed consistently.

## 4. Status Transition Validation

- [x] 4.1 Verify all public status-changing paths call the shared transition validator.
- [x] 4.2 Ensure `CLOSED -> IN_PROGRESS` is rejected through direct status patching.
- [x] 4.3 Ensure `CLOSED -> OPEN` remains allowed through reopen behavior and records a status change event.

## 5. Tests and Verification

- [x] 5.1 Add focused backend tests for Case create/list/detail/update/delete behavior.
- [x] 5.2 Add backend tests for invalid and valid status transitions, including `CLOSED -> IN_PROGRESS` rejection.
- [x] 5.3 Add backend tests for create-from-Conversation, duplicate create conflict, same-tenant link-to-existing-Case, and cross-tenant link rejection.
- [x] 5.4 Run Case-specific tests and document any unrelated repository build failures separately.
