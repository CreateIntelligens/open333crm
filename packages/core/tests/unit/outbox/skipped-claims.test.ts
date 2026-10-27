/**
 * 被認領擋下的副作用（change queue-monitoring：queue-monitoring「被認領擋下的副作用標示跳過」）。
 *
 * collectSkippedClaims() 的範圍內，claimSideEffect() 回傳 false 時收集這個認領鍵，
 * job processor 以回傳值列出重送時沒有再執行的副作用。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { claimSideEffect, collectSkippedClaims, hasSideEffectClaim } from '#src/outbox/claims.js';

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const EVENT = '22222222-2222-2222-2222-222222222222';

/** createMany 回傳的 count：0 代表鍵已存在，認領失敗 */
function fakeTx(count: 0 | 1) {
  return { sideEffectClaim: { createMany: async () => ({ count }) } } as never;
}

test('範圍內認領失敗時收集認領鍵', async () => {
  const { result, skippedClaims } = await collectSkippedClaims(async () => {
    const claimed = await claimSideEffect(fakeTx(0), {
      tenantId: TENANT,
      kind: 'automation_action',
      sourceId: EVENT,
      subKey: 'rule-1#0',
    });
    return claimed;
  });

  assert.equal(result, false);
  assert.deepEqual(skippedClaims, [{ kind: 'automation_action', sourceId: EVENT, subKey: 'rule-1#0' }]);
});

test('範圍內認領成功時不收集', async () => {
  const { skippedClaims } = await collectSkippedClaims(async () => {
    await claimSideEffect(fakeTx(1), { tenantId: TENANT, kind: 'bot_reply', sourceId: EVENT });
  });

  assert.deepEqual(skippedClaims, []);
});

test('不在範圍內時認領失敗不丟錯', async () => {
  const claimed = await claimSideEffect(fakeTx(0), { tenantId: TENANT, kind: 'sentiment', sourceId: EVENT });

  assert.equal(claimed, false);
});

test('兩個範圍同時執行時各自收集', async () => {
  const [a, b] = await Promise.all([
    collectSkippedClaims(async () => {
      await new Promise((r) => setTimeout(r, 5));
      await claimSideEffect(fakeTx(0), { tenantId: TENANT, kind: 'bot_reply', sourceId: 'a' });
    }),
    collectSkippedClaims(async () => {
      await claimSideEffect(fakeTx(0), { tenantId: TENANT, kind: 'bot_reply', sourceId: 'b' });
    }),
  ]);

  assert.deepEqual(a.skippedClaims.map((c) => c.sourceId), ['a']);
  assert.deepEqual(b.skippedClaims.map((c) => c.sourceId), ['b']);
});

/** count 回傳的筆數：1 代表認領鍵已有紀錄 */
function fakeDb(count: 0 | 1) {
  return { sideEffectClaim: { count: async () => count, createMany: async () => ({ count: 0 }) } } as never;
}

test('預先查詢到認領紀錄而跳過時也收集', async () => {
  // 機器人回覆與情緒分析在呼叫 LLM 之前先查認領紀錄，查到就不再認領
  const { skippedClaims } = await collectSkippedClaims(async () => {
    await hasSideEffectClaim(fakeDb(1), { tenantId: TENANT, kind: 'bot_reply', sourceId: EVENT });
    await hasSideEffectClaim(fakeDb(0), { tenantId: TENANT, kind: 'sentiment', sourceId: EVENT });
  });

  assert.deepEqual(skippedClaims, [{ kind: 'bot_reply', sourceId: EVENT }]);
});

test('同一個認領鍵先查詢、再認領失敗時只列一次', async () => {
  const key = { tenantId: TENANT, kind: 'bot_reply' as const, sourceId: EVENT };
  const { skippedClaims } = await collectSkippedClaims(async () => {
    await hasSideEffectClaim(fakeDb(1), key);
    await claimSideEffect(fakeDb(1), key);
  });

  assert.deepEqual(skippedClaims, [{ kind: 'bot_reply', sourceId: EVENT }]);
});
