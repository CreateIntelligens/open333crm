## Context

The LINE plugin already supports `reply` and `push`, but API `deliverToChannel()` does not accept delivery metadata and defaults to push. Worker keyword automation can pass a reply token, but it always selects reply when present. Webhook handlers acknowledge immediately and process asynchronously, so the original receipt time must be carried in the event payload.

## Goals / Non-Goals

**Goals:**

- Centralize the 30-second decision and reply-to-push fallback in both API and worker delivery paths.
- Keep one outbound CRM message record per logical send.
- Make late Agent/KB responses reliably use push.

**Non-Goals:**

- Changing LINE API authentication or message formatting.
- Retrying successful sends.
- Adding a database-backed delivery ledger in this change.

## Decisions

- Use a pure `selectSafeLineStrategy(receivedAt, now, replyToken)` helper with a hard 30,000 ms threshold, making the critical decision unit-testable.
- Use explicit `delivery` metadata on outbound payloads. API and worker implementations share the same policy but remain process-local because workers cannot access `fastify.io`.
- Treat missing or invalid receipt metadata as push. This is safer for old events and avoids sending expired reply tokens.
- On an explicit reply failure, issue one push attempt. Do not retry after a successful reply.
- Keep webhook acknowledgement unchanged: it returns HTTP 200 immediately, while asynchronous processing later applies SafeReply.

## Risks / Trade-offs

- **Ambiguous network timeout can produce duplicate LINE messages if reply succeeded remotely** → perform only one push fallback and log the fallback reason; a durable external idempotency ledger is out of scope.
- **Old events lack receipt time** → choose push rather than risk an expired reply token.
- **Concurrent duplicate processing** → existing webhook deduplication remains the first guard; this change does not alter it.

## Migration Plan

1. Deploy code; no database migration is needed.
2. Verify reply within 30 seconds, late Agent push, and failed-reply push fallback using LINE test channel logs.
3. Roll back by reverting the delivery helper and metadata propagation; existing push behavior remains safe.
