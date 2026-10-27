/**
 * 附券廣播「立即發送」與券詳情頁批次發券送出後馬上開始執行（change fix-coupon-broadcast-immediate-run，
 * spec coupon-management「附券廣播在背景執行且重送不重複發券」）。
 *
 * 2026-10-27 UAT：送出後要等每分鐘一次的排程才發送，發放紀錄停在「排入發送」最多一分鐘。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { OutboxInput } from '@open333crm/core';
import { queueCouponBroadcastFlow } from '#src/modules/marketing/broadcast-coupon.flow.js';
import { createCouponBroadcastProcessor } from '#src/modules/marketing/broadcast-coupon.worker.js';

const B = 'b0000000-0000-0000-0000-000000000001';
const T = 'a0000000-0000-0000-0000-000000000001';

/** 交易與 outbox 都以 mock 模擬：寫進 outbox 的 job 記在 written，commit 之後才記 dispatched */
function setup(status: string, updated = 1) {
  const written: OutboxInput[] = [];
  const log: string[] = [];
  const tx = {
    $executeRaw: async () => 1,
    broadcast: {
      findFirst: async () => ({ id: B, status, couponId: 'c1' }),
      updateMany: async () => ({ count: updated }),
    },
  };
  const prisma = {
    async $transaction(cb: (t: typeof tx) => Promise<unknown>) {
      const result = await cb(tx);
      log.push('commit');
      return result;
    },
  } as never;
  const events = {
    async write(_tx: unknown, input: OutboxInput) {
      written.push(input);
      return { id: 'o1', ...input, queueName: 'coupon-broadcast', jobOptions: null, createdAt: new Date() } as never;
    },
    async dispatch() {
      log.push('dispatch');
    },
  };
  return { deps: { prisma, events }, written, log };
}

test('立即發送後馬上開始執行', async () => {
  const { deps, written, log } = setup('draft');
  const queued = await queueCouponBroadcastFlow(deps, T, B, Date.parse('2026-10-27T02:00:00Z'));
  assert.equal(queued.status, 'scheduled');
  assert.equal(written.length, 1, '排入發送時一併排 job，不等每分鐘的排程');
  assert.equal(written[0].kind, 'job');
  assert.equal(written[0].kind === 'job' && written[0].queueName, 'coupon-broadcast');
  assert.deepEqual(written[0].payload, { tenantId: T, broadcastId: B });
  assert.deepEqual(log, ['commit', 'dispatch'], 'commit 之後才送進佇列');
  assert.equal('job' in queued, false, '回應不帶 job 的內容');
});

test('狀態不能發送時不排 job', async () => {
  const { deps, written } = setup('completed', 0);
  await assert.rejects(queueCouponBroadcastFlow(deps, T, B));
  assert.equal(written.length, 0);
});

test('job 交給附券廣播的執行，帶 job 上的租戶與廣播', async () => {
  const calls: Array<[string, string]> = [];
  const process = createCouponBroadcastProcessor(async (tenantId, broadcastId) => {
    calls.push([tenantId, broadcastId]);
    return { status: 'not_claimed' };
  });
  const result = await process({ data: { tenantId: 't1', broadcastId: B } } as never);
  assert.deepEqual(calls, [['t1', B]]);
  assert.deepEqual(result, { status: 'not_claimed' }, '已被排程搶先執行時不做事');
});
