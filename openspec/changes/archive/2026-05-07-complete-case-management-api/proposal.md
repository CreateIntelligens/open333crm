## Why

The current Case implementation covers the main happy path, but it does not fully match the documented Case Management API and relationship model. We need to close the remaining gaps so the API contract is explicit, transition validation is testable, and Conversation-to-Case linking does not drift from the product requirement.

## What Changes

- Add the missing case deletion contract for `DELETE /api/v1/cases/:id`, including tenant scoping and event cleanup behavior.
- Tighten the Case status transition contract so all status-changing API paths consistently reject invalid transitions such as `CLOSED -> IN_PROGRESS`.
- Clarify and complete Case-to-Conversation linking semantics:
  - A Conversation can be linked to one Case.
  - A Case can be linked to multiple Conversations for follow-up across channels.
  - Creating a Case from a Conversation must create the Case and link the triggering Conversation atomically.
- Add focused backend verification for Case CRUD, status transition rejection, and Conversation linking.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `case-management`: Complete the Case API lifecycle contract, status transition validation, and multi-conversation Case linking requirement.

## Impact

- API routes and service layer under `apps/api/src/modules/case`.
- Conversation create-case route under `apps/api/src/modules/conversation`.
- Case transition rules in `packages/shared/src/constants/case-transitions.ts`.
- Prisma relationship mapping in `packages/database/prisma/schema.prisma` if needed to support one Case with many Conversations.
- Backend tests or equivalent verification for Case CRUD, invalid status transitions, and Conversation linking.
