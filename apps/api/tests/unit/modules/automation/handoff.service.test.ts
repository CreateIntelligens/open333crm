/**
 * markConversationHandedOff()：對話的最後訊息時間與轉接系統訊息一致（PR #440 審查）。
 *
 * 知識庫轉接時同一個交易先寫機器人回覆（now），系統訊息晚 1 毫秒（systemCreatedAt）。
 * 對話的 lastMessageAt 要等於最後一則訊息（系統訊息）的時間。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { markConversationHandedOff } from '#src/modules/automation/handoff.service.js';
import { createMockTenantCtx } from '../../../support/mock-tenant-ctx.js';

function mockTx() {
  const updates: Array<Record<string, unknown>> = [];
  const tx = {
    conversation: {
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { count: 1 };
      },
      findFirst: async () => ({ id: 'conv-1', status: 'AGENT_HANDLED' }),
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'sys-1', ...data }),
    },
  };
  return { tx, updates };
}

test('知識庫轉接：對話的 lastMessageAt 等於系統訊息的時間（晚 1 毫秒）', async () => {
  const { tx, updates } = mockTx();
  const { ctx } = createMockTenantCtx(tx);
  const now = new Date('2026-11-03T08:00:00.000Z');
  const systemCreatedAt = new Date(now.getTime() + 1);

  const result = await markConversationHandedOff(ctx, {
    conversationId: 'conv-1',
    reason: '知識庫找不到可回答的內容，追問次數已達上限（2/2）',
    now,
    systemContent: { text: '已轉接真人' },
    systemMetadata: { type: 'auto_handoff' },
    systemCreatedAt,
  });

  assert.ok(result);
  assert.equal((result.systemMessage.createdAt as Date).getTime(), systemCreatedAt.getTime());
  assert.equal((updates[0].lastMessageAt as Date).getTime(), systemCreatedAt.getTime());
});

test('自動轉接（沒有 systemCreatedAt）：lastMessageAt 等於 now', async () => {
  const { tx, updates } = mockTx();
  const { ctx } = createMockTenantCtx(tx);
  const now = new Date('2026-11-03T08:00:00.000Z');

  await markConversationHandedOff(ctx, {
    conversationId: 'conv-1',
    reason: '機器人回覆次數已達上限',
    now,
    systemContent: { text: '已轉接真人' },
    systemMetadata: { type: 'auto_handoff' },
  });

  assert.equal((updates[0].lastMessageAt as Date).getTime(), now.getTime());
});
