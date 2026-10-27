/**
 * 附券廣播「立即發送」與券詳情頁批次發券送出後馬上開始執行（change fix-coupon-broadcast-immediate-run，
 * spec coupon-management「附券廣播在背景執行且重送不重複發券」）。
 *
 * 2026-10-27 UAT：送出後要等每分鐘一次的排程才發送，發放紀錄停在「排入發送」最多一分鐘。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';
import { queueCouponBroadcast } from '#src/modules/marketing/broadcast-coupon.service.js';
import { createCouponBroadcastProcessor } from '#src/modules/marketing/broadcast-coupon.worker.js';

const B = 'b0000000-0000-0000-0000-000000000001';

function txFor(status: string) {
  return {
    broadcast: {
      findFirst: async () => ({ id: B, status, couponId: 'c1' }),
      updateMany: async () => ({ count: 1 }),
    },
  };
}

test('立即發送後馬上開始執行', async () => {
  const { ctx, enqueued } = createMockTenantCtx(txFor('draft'));
  const queued = await queueCouponBroadcast(ctx, B, Date.parse('2026-10-27T02:00:00Z'));
  assert.equal(queued.status, 'scheduled');
  assert.equal(enqueued.length, 1, '排入發送時一併排 job，不等每分鐘的排程');
  assert.equal(enqueued[0].queueName, 'coupon-broadcast');
  assert.deepEqual(enqueued[0].data, { tenantId: ctx.tenantId, broadcastId: B });
});

test('狀態不能發送時不排 job', async () => {
  const tx = txFor('completed');
  tx.broadcast.updateMany = async () => ({ count: 0 });
  const { ctx, enqueued } = createMockTenantCtx(tx);
  await assert.rejects(queueCouponBroadcast(ctx, B));
  assert.equal(enqueued.length, 0);
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
