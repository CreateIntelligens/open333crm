## 1. Characterization Coverage

- [x] 1.1 Add focused tests that call `processInboundMessage` with the current public signature and assert callers do not need any new arguments.
- [x] 1.2 Add coverage for missing `contactUid` returning without DB writes, socket emits, or EventBus publishes.
- [x] 1.3 Add coverage for new contact/channel identity creation and existing channel identity reuse.
- [x] 1.4 Add coverage for conversation lookup by `options.conversationId` and fallback active conversation lookup.
- [x] 1.5 Add coverage for new conversation creation, initial `BOT_HANDLED`/`AGENT_HANDLED` botConfig behavior, and `conversation.created` publication.
- [x] 1.6 Add coverage for `options.clientMessageId` duplicate return behavior.
- [x] 1.7 Add coverage for normal inbound message persistence, unread increment, `message.new`, `conversation.updated`, and `message.received`.
- [x] 1.8 Add coverage for CSAT, KB feedback, and handoff_request intercept branches not publishing `message.received`.
- [x] 1.9 Add coverage for office-hours auto-reply and async media resolution behavior where practical.

## 2. Context And Payload Builders

- [x] 2.1 Add internal `InboundMessageContext` and result types under the webhook module.
- [x] 2.2 Keep `processInboundMessage` exported from `webhook.service.ts` with the exact existing parameter list and default options.
- [x] 2.3 Create context initialization that derives `plugin`, `now`, `contactUid`, `contentType`, `content`, `channelMsgId`, `textContent`, and `postbackData` once per message.
- [x] 2.4 Add lazy `getChannelSettings(ctx)` and `getBotConfig(ctx)` helpers that reuse the same fetched settings during one processing run.
- [x] 2.5 Add shared payload builders for inbound `message.new`, media-ready `message.new`, system handoff `message.new`, office-hours `message.new`, and `conversation.updated`.
- [x] 2.6 Verify payload builders preserve current event fields and room targets.

## 3. Core Processing Extraction

- [x] 3.1 Extract contact/channel identity resolution into a focused helper that uses the caller-provided `prisma`.
- [x] 3.2 Preserve `resolveUidToContact` stitching behavior and plugin profile fallback behavior.
- [x] 3.3 Extract conversation lookup/create logic into a focused helper.
- [x] 3.4 Preserve new conversation `conversation.created` EventBus publication.
- [x] 3.5 Extract duplicate client message check and return path.
- [x] 3.6 Extract sequence counting and inbound message creation into a focused helper.
- [x] 3.7 Ensure extracted helpers do not instantiate new Prisma clients or require caller-side changes.

## 4. Intercepts And Side Effects

- [x] 4.1 Extract CSAT, KB feedback, and handoff_request handling into explicit intercept handlers.
- [x] 4.2 Implement intercept orchestration as an ordered small chain that returns whether the message was consumed.
- [x] 4.3 Preserve the current intercept order: CSAT, KB feedback, handoff_request.
- [x] 4.4 Extract async media resolution while preserving non-blocking execution and error logging.
- [x] 4.5 Extract broadcast reply tracking, socket emission, `message.received` publication, canvas trigger dispatch, and office-hours auto-reply into focused side-effect helpers.
- [x] 4.6 Keep office-hours dedup cache behavior and timeout unchanged.

## 5. Facade Cleanup

- [x] 5.1 Rewrite `processInboundMessage` as a clear ordered workflow: initialize context, resolve contact, resolve conversation, create or return message, update conversation, run intercepts, emit/publish side effects, return result.
- [x] 5.2 Remove duplicated channel settings fetching from handoff and office-hours branches in favor of context reuse.
- [x] 5.3 Remove duplicated socket payload construction from `webhook.service.ts`.
- [x] 5.4 Keep `processWebhookEvent`, `webchat.service.ts`, and `chatbox.service.ts` call sites unchanged.
- [x] 5.5 Keep exported helper behavior such as `normalizeCanvasEventType` private/internal unless existing callers require it.

## 6. Verification

- [x] 6.1 Run the new characterization tests before and after extraction to confirm behavior parity.
- [x] 6.2 Run focused webhook/chatbox/webchat API tests.
- [ ] 6.3 Run `pnpm --filter @open333crm/api build`.
- [x] 6.4 Verify no Prisma schema migration was added.
- [x] 6.5 Verify `rg "processInboundMessage\\(" apps/api/src` shows unchanged caller argument patterns.
- [x] 6.6 Review socket payload snapshots/log assertions for field drift.
