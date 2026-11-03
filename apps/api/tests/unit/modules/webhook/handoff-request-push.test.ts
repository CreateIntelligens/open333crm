/**
 * 客人按「轉接真人」（postback handoff_request）後的推播房間（PR #438 審查）：
 * 系統訊息的 message.new 與其他 message.new 相同送到渠道房間（issue #427），
 * 列表與總店收得到，沒有渠道授權的成員收不到。
 *
 * 送出、遮罩與事件換成假的；資料庫只實作轉接用到的兩個方法。
 */
import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.mock('#src/modules/conversation/conversation.service.js', () => ({ deliverToChannel: async () => true }));
vi.mock('#src/modules/ai/deidentification.service.js', () => ({
  prepareStoredMessageContent: async (_p: unknown, _t: string, content: unknown) => ({ content, metadata: {} }),
}));
vi.mock('#src/events/event-bus.js', () => ({ eventBus: { publish: () => {} } }));

const { runInboundPostbackInterceptors } = await import('#src/modules/webhook/inbound-postback-interceptors.js');

const TENANT = 'a0000000-0000-0000-0000-000000000001';
const CHANNEL = 'd0000000-0000-0000-0000-00000000000d';
const CONVERSATION = 'c0000000-0000-0000-0000-00000000000c';

test('handoff_request 的 message.new 送到渠道房間與總店房間', async () => {
  const emitted: Array<{ rooms: string[]; event: string }> = [];
  const io = {
    to: (rooms: string | string[]) => ({
      emit: (event: string) => { emitted.push({ rooms: ([] as string[]).concat(rooms), event }); },
    }),
  };
  const now = new Date();
  const conversation = {
    id: CONVERSATION, tenantId: TENANT, channelId: CHANNEL, status: 'BOT_HANDLED',
    assignedToId: null, unreadCount: 0, lastMessageAt: now, updatedAt: now,
  };
  const prisma = {
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm-1', ...data, createdAt: now }),
    },
    conversation: {
      update: async () => ({ ...conversation, status: 'AGENT_HANDLED', handoffReason: 'user_requested_handoff' }),
    },
  };

  const handled = await runInboundPostbackInterceptors({
    prisma, io, tenantId: TENANT, postbackData: 'handoff_request', textContent: '', botConfig: {}, conversation,
  } as never);

  assert.equal(handled, true);
  const messageNew = emitted.find((e) => e.event === 'message.new');
  assert.ok(messageNew, '送出 message.new');
  assert.ok(messageNew.rooms.includes(`tenant:${TENANT}:channel:${CHANNEL}`), `送到渠道房間：${messageNew.rooms.join(',')}`);
  assert.ok(messageNew.rooms.includes(`tenant:${TENANT}:channels:all`), '送到總店房間');
});
