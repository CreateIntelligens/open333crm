## Context

Case Management is already wired into the API at `/api/v1/cases` and includes create, list, detail, patch, assign, resolve, close, reopen, escalate, events, notes, stats, and creating a case from a conversation. The remaining gaps are contract-level mismatches: the documented DELETE endpoint is absent, the status transition rules need explicit test coverage across API paths, and the current Conversation schema only supports a one-to-one Case link even though the product document says a Case can span multiple Conversations.

The implementation should stay within the existing Fastify + Prisma + Socket.IO shape. Case create/update/delete operations are primary HTTP request results, so tenant room socket events should use direct `fastify.io.to(...).emit(...)` from the API process. Async notification or automation side effects should continue through the existing `eventBus` path.

## Goals / Non-Goals

**Goals:**

- Complete the documented Case lifecycle API by adding tenant-scoped deletion.
- Preserve and verify status transition validation for every public status-changing path.
- Support linking multiple Conversations to one Case while preserving the invariant that one Conversation links to at most one Case.
- Keep Case events and socket updates consistent with existing behavior.
- Add backend tests or equivalent verification that exercises the completed contract.

**Non-Goals:**

- Build or redesign frontend Case screens.
- Implement advanced merge/sub-case workflows beyond preserving the existing Case relation model.
- Change RBAC policy beyond existing authenticated Case route behavior unless current guards already require it.
- Redesign automation, SLA, CSAT, or notification pipelines.

## Decisions

### Represent Case-to-Conversation as one Case to many Conversations

Use the existing `Conversation.caseId` foreign key as the source of truth, but remove the uniqueness constraint that limits a Case to one Conversation. In Prisma terms, the target model should expose `Case.conversations` instead of a singular `Case.conversation` relation. This preserves the current "one Conversation has one Case" invariant while allowing multiple Conversations to point at the same Case.

Alternative considered: introduce a separate join table. That would model many-to-many, but it would also allow one Conversation to link to multiple Cases unless additional constraints are added. The documented requirement only needs one Case across multiple Conversations, not many-to-many.

### Make creating a Case from a Conversation atomic

`POST /api/v1/conversations/:id/case` should create the Case and set the triggering Conversation's `caseId` in one transaction. The service should reject attempts to create a second Case for an already linked Conversation with `409 CONFLICT`.

Alternative considered: keep the current two-step create then update. It is simpler, but a failure after Case creation can leave an unlinked Case and makes verification harder.

### Add explicit link-existing-Case behavior only if implementation needs it

The core requirement is that a Case can span multiple Conversations. This can be completed by adding a service/API path that links a Conversation to an existing Case, or by extending an existing Case update route if that shape is already present. The chosen implementation must keep tenant scoping on both Case and Conversation and must reject linking an already-linked Conversation.

Alternative considered: only change the schema and create-from-conversation path. That makes the model capable of one-to-many but does not provide a user/API path to actually add a second Conversation to an existing Case.

### Deletion removes the Case and dependent Case records

`DELETE /api/v1/cases/:id` should be tenant-scoped and authenticated. It should remove the Case and dependent Case events/notes through existing cascade behavior, unlink Conversations that point at the Case, emit `case.deleted` to the tenant room, and return a success response.

Alternative considered: soft-delete through `status = CLOSED`. That avoids destructive deletes, but it does not satisfy the documented DELETE API and makes the endpoint misleading.

### Use shared transition rules for all public status changes

All public paths that change status should call the same transition validator backed by `packages/shared/src/constants/case-transitions.ts`. This includes direct status patching and action endpoints like resolve, close, reopen, and escalate. Tests should cover `CLOSED -> IN_PROGRESS` rejection specifically because that was the requested validation.

## Risks / Trade-offs

- Schema change can affect code that expects `case.conversation` to be singular -> update includes/selects and frontend consumers to use `conversations` or an explicitly selected primary conversation if needed.
- Hard deletion may remove useful audit history -> deletion should be limited to authenticated users per current route policy and should emit a clear event; if audit retention becomes required later, introduce soft-delete as a separate change.
- Existing generated Prisma client may be out of sync with schema -> regenerate Prisma client and verify API build as part of implementation.
- Current repo has unrelated build failures in KB/settings areas -> Case tests should be runnable independently, and final verification should distinguish Case-specific results from unrelated compile failures.
