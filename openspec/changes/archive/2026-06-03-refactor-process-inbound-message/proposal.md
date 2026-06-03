## Why

`processInboundMessage` in `apps/api/src/modules/webhook/webhook.service.ts` has grown into a long multi-responsibility function that handles contact resolution, conversation creation, message persistence, postback intercepts, socket payloads, automation events, media resolution, and office-hours replies in one place. This makes future webhook/chatbox/webchat changes risky because small behavior changes are hard to isolate and duplicated object construction can drift.

## What Changes

- Refactor `processInboundMessage` into smaller SOLID-oriented collaborators while keeping the exported function signature, options object, return shape, and caller behavior unchanged.
- Keep `processInboundMessage(prisma, io, credentials, channel, tenantId, parsed, options?)` as the compatibility facade used by webhook, webchat, and chatbox callers.
- Introduce an internal per-message processing context that reuses the same `PrismaClient`, `SocketIOServer`, channel, tenant, parsed message, plugin, contact, conversation, message, timestamps, and channel settings instead of repeatedly rebuilding or refetching equivalent objects.
- Extract focused responsibilities for contact/channel identity resolution, conversation lookup/creation, inbound message persistence/idempotency, postback intercept handling, socket payload emission, media resolution, event publishing, canvas trigger dispatch, and office-hours auto-reply.
- Centralize repeated payload builders for `message.new` and `conversation.updated` so socket events remain consistent.
- Add characterization tests around current behavior before and during refactor to guard against behavior drift.
- Preserve existing webchat, chatbox, webhook, automation, CSAT, KB feedback, handoff, broadcast reply, office-hours, and socket behavior.

## Capabilities

### New Capabilities
- `inbound-message-processing`: Stable inbound message processing contract and behavior-preserving refactor constraints for the webhook/chatbox/webchat inbound pipeline.

### Modified Capabilities
- None.

## Impact

- Backend API only: `apps/api/src/modules/webhook/webhook.service.ts` and new internal helper/service files under the webhook module.
- Existing callers remain unchanged: `processWebhookEvent`, `webchat.service.ts`, and `chatbox.service.ts`.
- No database schema change.
- No new external dependencies.
- Tests: focused characterization tests for duplicate client messages, contact/channel identity creation, conversation creation/status, CSAT/KB/handoff intercepts, socket payloads, event publishing, media handling, and office-hours auto-reply.
