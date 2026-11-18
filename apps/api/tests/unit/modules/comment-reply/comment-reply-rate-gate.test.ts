/**
 * 留言私訊的 token bucket（change add-comment-keyword-private-reply tasks 5.2，design D12）。
 *
 * 算法以純函式 takeFromBucket() 測；createRedisRateGate() 的接線（鍵、參數、暫停）以假的 Redis 測：
 * 假的 eval 用同一個純函式處理，確認 gate 把平台設定的每小時上限轉成容量與補充速率傳進去。
 * Lua 本身由 feature 測試（comment-reply-delivery.test.ts「本小時額度用完」）以真的 Redis 驗證。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'vitest';
import {
  bucketParams,
  createRedisRateGate,
  rateBucketKey,
  ratePauseKey,
  takeFromBucket,
  type BucketState,
} from '#src/modules/comment-reply/comment-reply-rate-gate.js';
import { resolveCommentReplyPlatformSettings } from '#src/modules/comment-reply/comment-reply-platform-settings.js';

describe('token bucket 補充與容量', () => {
  test('容量是每小時上限 ÷ 12，用完後要等下一個 token', () => {
    const perHour = 720; // 容量 60、每 5 秒補 1 個
    assert.equal(bucketParams(perHour).capacity, 60);
    let state: BucketState | null = null;
    const now = 1_000_000;
    let ok = 0;
    for (let i = 0; i < 61; i++) {
      const r = takeFromBucket(state, now, perHour);
      state = r.state;
      if (r.result.ok) ok += 1;
      else assert.equal(r.result.retryAfterMs, 5000);
    }
    assert.equal(ok, 60);
  });

  test('經過時間補充 token，不超過容量', () => {
    const perHour = 720;
    const empty: BucketState = { tokens: 0, ts: 0 };
    assert.equal(takeFromBucket(empty, 4_999, perHour).result.ok, false);
    assert.equal(takeFromBucket(empty, 5_000, perHour).result.ok, true);
    const after = takeFromBucket(empty, 10 * 3_600_000, perHour);
    assert.equal(after.result.ok, true);
    assert.equal(after.state.tokens, 59);
  });
});

/** 假的 Redis：eval 以純函式模擬 Lua，set 記下暫停時間 */
function fakeRedis() {
  const buckets = new Map<string, BucketState>();
  const paused = new Map<string, number>();
  const evalCalls: string[][] = [];
  return {
    buckets,
    paused,
    evalCalls,
    async eval(_script: string, _n: number, key: string, pauseKey: string, now: string, capacity: string, refill: string) {
      evalCalls.push([key, pauseKey, now, capacity, refill]);
      const t = Number(now);
      const until = paused.get(pauseKey) ?? 0;
      if (until > t) return [0, until - t];
      const perHour = Number(refill) * 3_600_000;
      const r = takeFromBucket(buckets.get(key) ?? null, t, perHour);
      buckets.set(key, r.state);
      return r.result.ok ? [1, 0] : [0, r.result.retryAfterMs];
    },
    async set(key: string, value: string) {
      paused.set(key, Number(value));
      return 'OK';
    },
  };
}

describe('createRedisRateGate', () => {
  test('渠道之間互不影響', async () => {
    const redis = fakeRedis();
    const gate = createRedisRateGate(redis as never);
    for (let i = 0; i < 1; i++) assert.equal((await gate.take('pm', 'A', 12, 0)).ok, true); // 容量 1
    assert.equal((await gate.take('pm', 'A', 12, 0)).ok, false);
    assert.equal((await gate.take('pm', 'B', 12, 0)).ok, true);
    assert.equal((await gate.take('pr', 'A', 12, 0)).ok, true, '公開回覆另一個 bucket');
    assert.deepEqual(redis.evalCalls.map((c) => c[0]), [rateBucketKey('pm', 'A'), rateBucketKey('pm', 'A'), rateBucketKey('pm', 'B'), rateBucketKey('pr', 'A')]);
  });

  test('Meta retryAfterMs 暫停該渠道', async () => {
    const redis = fakeRedis();
    const gate = createRedisRateGate(redis as never);
    await gate.pause('pm', 'A', 60_000, 1000);
    assert.equal(redis.paused.get(ratePauseKey('pm', 'A')), 61_000);
    const r = await gate.take('pm', 'A', 700, 31_000);
    assert.deepEqual(r, { ok: false, retryAfterMs: 30_000 });
    assert.equal((await gate.take('pm', 'B', 700, 31_000)).ok, true);
    assert.equal((await gate.take('pm', 'A', 700, 61_000)).ok, true);
  });

  test('數字來自平台設定', async () => {
    const settings = resolveCommentReplyPlatformSettings({ 'commentReply.rateLimits': { fbPerHour: 1200, igPerHour: 360, publicReplyPerHour: 300 } });
    const redis = fakeRedis();
    const gate = createRedisRateGate(redis as never);
    await gate.take('pm', 'fb', settings.rateLimits.fbPerHour, 0);
    await gate.take('pm', 'ig', settings.rateLimits.igPerHour, 0);
    assert.equal(redis.evalCalls[0]![3], '100');
    assert.equal(redis.evalCalls[1]![3], '30');
    assert.equal(Number(redis.evalCalls[0]![4]) * 3_600_000, 1200);
    // 沒有設定時用預設值 FB 700、IG 700、公開回覆 300
    const defaults = resolveCommentReplyPlatformSettings({});
    assert.deepEqual(defaults.rateLimits, { fbPerHour: 700, igPerHour: 700, publicReplyPerHour: 300 });
  });
});
