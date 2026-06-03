## Context

`processInboundMessage` is the shared inbound persistence path for channel webhooks, webchat, and chatbox. It currently sits in `apps/api/src/modules/webhook/webhook.service.ts` and is called by:

- `processWebhookEvent(...)` after signature verification and plugin parsing.
- `apps/api/src/modules/webchat/webchat.service.ts` for webchat visitor messages.
- `apps/api/src/modules/chatbox/chatbox.service.ts` with `conversationId`, `clientMessageId`, and message metadata options.

The function is currently long because it owns many unrelated responsibilities:

- Resolve channel plugin, channel identity, and contact.
- Optionally stitch existing contacts by channel UID.
- Fetch profile data through channel plugin fallback.
- Find or create conversation and publish `conversation.created`.
- Check client-message idempotency.
- Count sequence and create inbound message.
- Resolve inbound media asynchronously.
- Update conversation timestamps/unread count.
- Intercept CSAT, KB feedback, and handoff postbacks.
- Track broadcast replies.
- Emit `message.new` and `conversation.updated`.
- Publish `message.received`.
- Trigger canvas webhook flows.
- Send outside-hours auto-replies with a local dedup cache.

The refactor must preserve behavior. Existing callers must not change.

## Goals / Non-Goals

**Goals:**
- Keep the exported `processInboundMessage(...)` signature exactly compatible.
- Split implementation into focused collaborators that follow single-responsibility boundaries.
- Reuse the same `PrismaClient` object provided by the caller throughout the pipeline.
- Reuse per-message objects through a context object instead of repeatedly reconstructing plugin, channel settings, socket payloads, timestamps, contact/conversation/message references, or parsed text/postback metadata.
- Preserve return values: early `undefined` for missing contact UID or intercepts, `{ conversation, message, duplicate: true }` for duplicate client messages, and `{ conversation, message, duplicate: false }` for normal persisted inbound messages.
- Add characterization tests before changing structure.

**Non-Goals:**
- Do not change webhook signature verification or parse behavior.
- Do not change the input parameters of `processInboundMessage`.
- Do not require updates in webhook, webchat, chatbox, or simulator callers.
- Do not add database schema changes.
- Do not change socket event names, room names, payload fields, or EventBus event names.
- Do not convert the pipeline to worker-owned processing.

## Decisions

1. Keep `processInboundMessage` as a facade.
   - The exported function remains in `webhook.service.ts`.
   - It builds an `InboundMessageContext`, invokes internal steps, and returns the same values as today.
   - Rationale: callers stay stable while internal structure improves.
   - Alternative considered: expose a new service entrypoint and migrate callers. Rejected because the user explicitly wants callers unchanged.

2. Use a workflow/application-service style, not a heavy abstraction pattern.
   - The suitable structure is a behavior-preserving facade that orchestrates ordered business steps.
   - This function contains many business rules, so most extraction should be named business operations rather than generic abstractions.
   - Only the postback intercept section naturally fits a small Chain of Responsibility shape because CSAT, KB feedback, and handoff each decide whether they consumed the message.
   - Rationale: applying Strategy/Factory broadly would add indirection without removing real complexity.
   - Alternative considered: a generic pipeline framework. Rejected because the step order and side effects are domain-specific and should stay explicit.

3. Add a shared internal context object.
   - Context includes `prisma`, `io`, `credentials`, `channel`, `tenantId`, `parsed`, `options`, `plugin`, `now`, `contactUid`, `contentType`, `content`, `channelMsgId`, `textContent`, `postbackData`, optional `channelSettings`, optional `botConfig`, resolved `contactId`, `channelIdentity`, `conversation`, and `message`.
   - Helpers mutate or return narrow parts of this context in a controlled order.
   - Rationale: this reduces repeated object production and repeated derivation while keeping each helper testable.

4. Use focused modules under the webhook module.
   - Suggested files:
     - `inbound-message.types.ts`: context and narrow result types.
     - `inbound-contact-resolver.ts`: channel identity/contact/profile/stitching.
     - `inbound-conversation-resolver.ts`: conversation lookup/create and initial bot mode.
     - `inbound-message-writer.ts`: duplicate check, sequence count, inbound message create.
     - `inbound-postback-interceptors.ts`: CSAT, KB feedback, handoff request.
     - `inbound-socket-presenter.ts`: `message.new`, `conversation.updated`, and media-ready payload builders/emitters.
     - `inbound-side-effects.ts`: broadcast reply, EventBus `message.received`, canvas trigger, office-hours auto-reply, async media resolution.
   - Rationale: each file has a clear reason to change.

5. Cache channel settings within the context for the current message.
   - Current code fetches channel settings in multiple places for initial conversation status, handoff message, and outside-hours offline greeting.
   - Add a helper like `getChannelSettings(ctx)` and `getBotConfig(ctx)` that lazily fetch once per processed message and then reuses the result.
   - Rationale: this directly addresses repeated object creation/refetching without changing persistence behavior.

6. Centralize socket payload builders.
   - Build `message.new` payloads from message records in one place.
   - Build `ConversationUpdatedPayload` from conversation records in one place.
   - Preserve all current fields: `conversationId`, message `id`, `direction`, `senderType`, `senderId` where present, `contentType`, `content`, `type`, `payload`, `createdAt`, `sequence` where present, and `metadata`/`sender` for system handoff messages where currently emitted.
   - Rationale: duplicated payload construction is one of the easiest places for behavior drift.

7. Characterization tests come before mechanical extraction.
   - Use existing API test style in `apps/api/src/__tests__`.
   - Mock Prisma/socket/eventBus collaborators enough to assert call order and emitted payloads for important branches.
   - Rationale: refactor safety matters more than new abstractions.

## Risks / Trade-offs

- Behavior drift in intercept branches -> Add characterization tests for CSAT, KB feedback, and handoff before extracting them.
- Async media resolution captures stale values -> Keep the same message, conversation, tenant, credentials, and plugin references in the async helper and preserve non-blocking error logging.
- Context object becomes a hidden global bag -> Keep it per-message only, typed, and pass explicit narrow subsets to helpers when practical.
- Too much extraction creates indirection -> Extract only current responsibilities that have independent reasons to change; leave tiny glue logic in the facade.
- Tests over-mock Prisma and miss integration behavior -> Pair helper unit tests with one or two higher-level facade tests that assert final return shape and emitted events.

## Migration Plan

1. Add characterization tests around current `processInboundMessage` behavior.
2. Add internal context and payload builder types without changing behavior.
3. Extract contact/channel identity resolution.
4. Extract conversation resolution and channel settings/botConfig reuse.
5. Extract duplicate check, sequence count, and message creation.
6. Extract postback intercept handlers.
7. Extract socket payload builders and emitters.
8. Extract media resolution and post-persist side effects.
9. Keep `processInboundMessage` as facade and verify all existing callers compile unchanged.

Rollback: because this is internal-only refactor with no schema changes, rollback is reverting the extracted files and restoring the original function body.

## Open Questions

- Should `simulateInboundMessage` be aligned to the same internal helpers later, or remain separate because it currently has its own simplified flow?
- Should office-hours dedup cache remain in `webhook.service.ts` or move with the office-hours side-effect helper?
