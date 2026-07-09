/**
 * Loop guard for LINE downstream webhook forwarding.
 *
 * We forward the *verbatim* raw body (with the valid `x-line-signature`) to a
 * downstream URL. If that downstream ever posts the payload back to our webhook
 * endpoint it re-passes signature verification and would be forwarded again —
 * an infinite loop / amplification. To break it we record each event's id
 * (LINE `webhookEventId`, falling back to `replyToken`) in Redis with a TTL and
 * refuse to forward a payload whose events we have all already seen.
 */

import IORedis from 'ioredis';
import { logger } from '@open333crm/core';
import { getConfig } from '../../config/env.js';

const LOOP_GUARD_TTL_SECONDS = 600; // 10 min: long enough to break relay loops, keys auto-expire
const KEY_PREFIX = 'line-downstream:seen';

/** Minimal Redis surface used here (injectable for testing). */
export interface LoopGuardStore {
  set(
    key: string,
    value: string,
    exFlag: 'EX',
    seconds: number,
    nxFlag: 'NX',
  ): Promise<'OK' | null>;
}

let redisClient: IORedis | null = null;
function getRedis(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(getConfig().REDIS_URL, { maxRetriesPerRequest: 2 });
    redisClient.on('error', (err: Error) =>
      logger.warn('[DownstreamLoopGuard] Redis error', { error: err?.message }),
    );
  }
  return redisClient;
}

/**
 * Extract per-event dedup ids from a raw LINE webhook body. Prefers
 * `webhookEventId` (present on every LINE event) and falls back to
 * `replyToken`. Returns [] on unpariseable/eventless bodies.
 */
export function extractEventIds(rawBody: Buffer): string[] {
  try {
    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      events?: Array<Record<string, unknown>>;
    };
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    const ids: string[] = [];
    for (const e of events) {
      const id = (e?.webhookEventId ?? e?.replyToken) as string | undefined;
      if (typeof id === 'string' && id) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * Claim a webhook payload for downstream forwarding. Records each event id in
 * the store with a TTL (SET NX). Returns true when at least one event is new
 * (safe to forward), false when every event was already seen — i.e. our own
 * forward was shot back (loop), so the caller MUST NOT forward again.
 *
 * Fails open (returns true) when there are no dedup ids or the store errors,
 * so an unavailable Redis never silently disables forwarding.
 */
export async function claimForForward(
  channelId: string,
  rawBody: Buffer,
  store: LoopGuardStore = getRedis(),
): Promise<boolean> {
  const ids = extractEventIds(rawBody);
  if (ids.length === 0) return true; // nothing to dedup on → best-effort forward
  try {
    let anyNew = false;
    for (const id of ids) {
      const key = `${KEY_PREFIX}:${channelId}:${id}`;
      const res = await store.set(key, '1', 'EX', LOOP_GUARD_TTL_SECONDS, 'NX');
      if (res === 'OK') anyNew = true;
    }
    return anyNew;
  } catch (err) {
    logger.warn('[DownstreamLoopGuard] Store unavailable — forwarding without loop guard', {
      channelId,
      error: (err as Error).message,
    });
    return true; // fail open
  }
}
