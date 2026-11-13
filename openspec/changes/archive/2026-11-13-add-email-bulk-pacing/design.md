# Design

## Context

`EmailFailoverCoordinator` previously enforced only fixed concurrency (`3` SMTP / `5` Resend) and hardcoded `60_000`ms cooldown, with no per-second rate limiter and no batch queue. Triggering 5,000 emails simultaneously fails all callers beyond concurrency `3` or hits SES `14/sec` (`454 Maximum sending rate exceeded`), which previously tripped the circuit to Resend.

## Goals / Non-Goals

**Goals:** Make provider concurrency, per-second rate limits, bulk headroom reservation, cooldown, and batch chunk size configurable via env; enforce 1-second sliding-window rate limits in Redis Lua; automatically chunk and stagger large batches (such as 5,000 emails) via BullMQ `email-dispatch`; and keep transactional emails unblocked by bulk traffic.

**Non-Goals:** Replacing external bulk marketing channels (LINE/FB/IG broadcasts); building a multi-tenant per-sender custom SMTP pool.

## Decisions

- **Parameter scaling in `env.ts`:** `EMAIL_SMTP_RATE_PER_SEC` defaults to `10` (safely below SES Tokyo `14/sec`). `EMAIL_SMTP_BULK_RATE_PER_SEC` is optional; when omitted it defaults to `Math.max(1, Math.floor(EMAIL_SMTP_RATE_PER_SEC * 0.8))` (`8/sec` at default `10`), automatically scaling when operators raise or lower `EMAIL_SMTP_RATE_PER_SEC`.
- **Redis Cluster-safe sliding-window rate limiter:** Use fixed ZSET keys (`{prefix}:smtp-rate`, `{prefix}:resend-rate`, `{prefix}:smtp-bulk-rate`) passed in `KEYS[5..7]` with the same `{email:provider-failover}` hash tag. Using ZSET with `TIME` millisecond scores eliminates boundary double-bursts and avoids dynamic key names inside Lua.
- **Throttling vs Outage:** `454 Throttling failure: Maximum sending rate exceeded` calls `finish(lease, 'throttled')` (releases lease, keeps SES circuit closed) and throws `EmailCapacityError('throttled', 1000)` instead of dumping bulk traffic onto Resend. `454 Daily message quota exceeded` still triggers Resend failover.
- **Transactional pacing vs Bulk queueing:** Direct `transactional` calls wait briefly (up to `1500ms` total) on `rate_limited` so sequential bursts smooth out, while `bulk` calls throw `EmailCapacityError` immediately so the `email-dispatch` BullMQ worker calls `job.moveToDelayed(...)` + `throw new DelayedError()` without blocking worker concurrency slots.
- **Batch staggering & Canvas integration:** `enqueueEmailBatch` splits large arrays by `EMAIL_BATCH_SIZE` (default `100`) and calls `queue.addBulk` with staggered `delay = Math.floor(i / ratePerSec) * 1000`. `setupCanvasWorker` accepts `enqueueEmail` so Canvas Email nodes persist and pace through `email-dispatch`. `EMAIL_DISPATCH_QUEUE` is exported from `@open333crm/core` and added to `API_QUEUES` in `monitored-queues.ts`.

## Risks / Trade-offs

- **5,000 emails duration:** At default `8/sec` bulk rate, 5,000 emails take ~10.4 minutes. Operators with higher SES quotas can raise `EMAIL_SMTP_RATE_PER_SEC` and `EMAIL_SMTP_MAX_CONCURRENCY` via `.env` without code changes.
- **Staggered delay uses queue time:** If `enqueueEmailBatch` is called multiple times simultaneously by two processes, staggered `delay` distributes wakeups while the Redis Lua sliding-window guarantees the combined send rate stays under `EMAIL_SMTP_BULK_RATE_PER_SEC`.
