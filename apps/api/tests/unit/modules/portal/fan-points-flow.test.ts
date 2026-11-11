/**
 * 粉絲的積分餘額與交易清單來自同一次查詢（主規格 portal-activity「積分帳本的餘額依序累計」）。
 *
 * read committed 之下，交易內的每個查詢各自讀取最新 commit 的資料。
 * 餘額與清單分兩次查詢時，兩次之間有人寫入一筆，回應的餘額就是舊的、清單卻已經是新的。
 * 這裡以 mock 讓兩次查詢讀到不同的帳本，模擬中間有一筆寫入。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createFlowLog, mockTransactionPrisma } from '#tests/support/flow-harness.js';
import { MOCK_TENANT_ID } from '#tests/support/mock-tenant-ctx.js';
import { getFanPointsFlow } from '#src/modules/portal/portal.flow.js';

test('粉絲的積分餘額與交易清單一致', async () => {
  const before = [{ id: 't-1', amount: 10, balance: 10 }];
  const after = [{ id: 't-2', amount: 3, balance: 13 }, ...before];
  const tx = {
    pointTransaction: {
      // 讀餘額時還沒有 t-2；讀清單時 t-2 已經 commit
      findFirst: async () => ({ balance: before[0].balance, createdAt: new Date() }),
      findMany: async () => after,
      count: async () => after.length,
    },
  };

  const result = await getFanPointsFlow(
    { prisma: mockTransactionPrisma(createFlowLog(), tx) },
    { tenantId: MOCK_TENANT_ID, contactId: 'contact-1' },
  );

  assert.equal(result.transactions.items[0].balance, 13);
  assert.equal(result.balance, 13, '餘額取自清單的最新一筆');
});

test('沒有積分紀錄時，餘額是 0', async () => {
  const tx = { pointTransaction: { findFirst: async () => null, findMany: async () => [], count: async () => 0 } };
  const result = await getFanPointsFlow(
    { prisma: mockTransactionPrisma(createFlowLog(), tx) },
    { tenantId: MOCK_TENANT_ID, contactId: 'contact-1' },
  );
  assert.equal(result.balance, 0);
});
