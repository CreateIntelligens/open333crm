/**
 * 積分帳本的「最新一筆」在時間相同時也是固定的同一筆（主規格 portal-activity「積分帳本的餘額依序累計」）。
 *
 * addPointTransaction() 保證新寫入的一筆比最新一筆晚 1 毫秒，但修正之前寫入的舊資料可能有時間相同的紀錄。
 * 只依 createdAt 排序時，getLatestPointEntry() 與交易清單可能各自選到不同的一筆，
 * 粉絲看到的餘額與下一筆寫入用的餘額就不一致。兩個查詢都以 id 當第二排序，選到同一筆。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createMockTenantCtx } from '#tests/support/mock-tenant-ctx.js';
import { getLatestPointEntry, listPointTransactions } from '#src/modules/portal/points.service.js';

const LEDGER_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }];

test('時間相同的積分紀錄，最新一筆與交易清單的排序相同', async () => {
  const orders: unknown[] = [];
  const tx = {
    pointTransaction: {
      findFirst: async (args: { orderBy: unknown }) => {
        orders.push(args.orderBy);
        return null;
      },
      findMany: async (args: { orderBy: unknown }) => {
        orders.push(args.orderBy);
        return [];
      },
      count: async () => 0,
    },
  };
  const { ctx } = createMockTenantCtx(tx);

  await getLatestPointEntry(ctx, 'contact-1');
  await listPointTransactions(ctx, 'contact-1');

  assert.deepEqual(orders, [LEDGER_ORDER, LEDGER_ORDER]);
});
