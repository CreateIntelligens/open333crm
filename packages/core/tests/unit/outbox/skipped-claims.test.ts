/**
 * 被認領擋下的副作用（change queue-monitoring：queue-monitoring「被認領擋下的副作用標示跳過」）。
 *
 * collectSkippedClaims() 的範圍內，claimSideEffect() 回傳 false 時收集這個認領鍵，
 * job processor 以回傳值列出重送時沒有再執行的副作用。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { claimSideEffect, collectSkippedClaims } from '#src/outbox/claims.js';

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
