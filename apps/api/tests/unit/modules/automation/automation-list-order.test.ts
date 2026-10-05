/**
 * 規則列表以 offset 分頁，前端逐頁取回全部規則。排序原本只有 priority、createdAt，
 * 多數規則 priority 都是 0，createdAt 相同時（批次建立）PostgreSQL 不保證順序，
 * 第 1 頁與第 2 頁可能重複或漏掉同一條規則。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { listRules } from '#src/modules/automation/automation.service.js';

test('Rules share priority and creation time：依 priority、createdAt、id 排序', async () => {
  let orderBy: unknown;
  const prisma = {
    automationRule: {
      findMany: async (args: { orderBy: unknown }) => {
        orderBy = args.orderBy;
        return [];
      },
      count: async () => 0,
    },
  };
  await listRules(prisma as never, 'tenant-1', {}, { page: 2, limit: 100 });
  assert.deepEqual(orderBy, [{ priority: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
});
