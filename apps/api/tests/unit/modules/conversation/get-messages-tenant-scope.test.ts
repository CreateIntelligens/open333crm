/**
 * getMessages() 的查詢條件帶 tenantId（多租戶第一層，change fix-chat-window-load-older-468）。
 *
 * feature 測試走 app_tenant 連線，RLS 會擋掉其他租戶，拿掉 where 的 tenantId 也看不出來，
 * 所以第一層在這裡用 mock 執行器檢查。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getMessages } from '#src/modules/conversation/conversation.service.js';
import { createMockTenantCtx, MOCK_TENANT_ID as TENANT } from '#tests/support/mock-tenant-ctx.js';

function mockDb() {
  const calls: { findMany: unknown[]; count: unknown[] } = { findMany: [], count: [] };
  const db = {
    message: {
      findMany: async (args: unknown) => {
        calls.findMany.push(args);
        return [];
      },
      count: async (args: unknown) => {
        calls.count.push(args);
        return 0;
      },
    },
  };
  return { db, calls };
}

test('getMessages：查詢與計數都限定目前租戶的對話', async () => {
  const { db, calls } = mockDb();
  const { ctx } = createMockTenantCtx(db);
  await getMessages(ctx, 'conv-1', { page: 1, limit: 50, order: 'desc' });

  const findWhere = (calls.findMany[0] as { where: Record<string, unknown> }).where;
  const countWhere = (calls.count[0] as { where: Record<string, unknown> }).where;
  assert.equal(findWhere.conversationId, 'conv-1');
  assert.deepEqual(findWhere.conversation, { tenantId: TENANT });
  assert.deepEqual(countWhere.conversation, { tenantId: TENANT });
});
