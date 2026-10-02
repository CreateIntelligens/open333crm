/** 記錄工單首次回應失敗時，客服訊息仍照常送出（AUDIT SLA-01） */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('#src/modules/case/case.service.js', () => ({
  markCaseFirstResponse: async () => {
    throw new Error('db hiccup');
  },
}));

test('markCaseFirstResponse 出錯：sendMessage 不中斷，照常推播訊息', async () => {
  const { sendMessage } = await import('#src/modules/conversation/conversation.service.js');
  const emitted: string[] = [];
  const io = { to: () => ({ emit: (event: string) => emitted.push(event) }) } as never;
  const prisma = {
    conversation: {
      findFirst: async () => ({ id: 'c1', tenantId: 't1', channelId: 'ch1', caseId: 'case1' }),
      update: async () => ({}),
      findUnique: async () => ({ channel: { isActive: false }, contact: { channelIdentities: [] } }),
    },
    message: {
      count: async () => 0,
      create: async (args: { data: Record<string, unknown> }) => ({ id: 'm1', ...args.data, createdAt: new Date(), sender: null }),
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
    },
  } as never;
  await sendMessage(prisma, io, 'c1', 'a1', 't1', { contentType: 'text', content: { text: 'hi' } });
  assert.ok(emitted.includes('message.new'), '訊息仍要推播');
});
