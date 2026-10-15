/**
 * 以平台訊息 ID 去重（主規格 inbound-message-processing「以平台訊息 ID 去重」，
 * change restore-instagram-channel-spec）。Meta 會重複投遞同一個 webhook 事件。
 */
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-inbound-dedup-jwt-secret';

import { test } from 'vitest';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';

const EXISTING = { id: 'message-existing', conversationId: 'conversation-1', channelMsgId: 'm-1', contentType: 'text', content: { text: '在嗎' } };

function setup(message: Record<string, unknown>) {
  const socket: string[] = [];
  const conversationUpdates: unknown[] = [];
  const conversation = {
    id: 'conversation-1', tenantId: 'tenant-1', contactId: 'contact-1', channelId: 'channel-1', channelType: 'THREADS',
    status: 'BOT_HANDLED', assignedToId: null, unreadCount: 0, lastMessageAt: null, updatedAt: new Date(),
  };
  const prisma = {
    channelIdentity: { findUnique: async () => ({ id: 'identity-1', contactId: 'contact-1', contact: { id: 'contact-1' } }) },
    conversation: {
      findFirst: async () => conversation,
      update: async (args: unknown) => {
        conversationUpdates.push(args);
        return conversation;
      },
    },
    message,
  };
  const io = { to: () => ({ emit: (event: string) => socket.push(event) }) };
  return { prisma, io, socket, conversationUpdates };
}

async function receive(prisma: unknown, io: unknown) {
  const events: AppEvent[] = [];
  const handler = (event: AppEvent) => events.push(event);
  eventBus.subscribe('*', handler);
  try {
    const result = await processInboundMessage(
      prisma as never,
      io as never,
      {},
      { id: 'channel-1', channelType: 'THREADS' },
      'tenant-1',
      { contactUid: 'ig-user-1', channelMsgId: 'm-1', timestamp: new Date(), contentType: 'text', content: { text: '在嗎' } },
    );
    return { result, events };
  } finally {
    eventBus.unsubscribe('*', handler);
  }
}

test('平台重送同一則訊息：回傳既有的訊息與 duplicate: true，不建立、不推播、不發布事件', async () => {
  const lookups: unknown[] = [];
  let created = 0;
  const { prisma, io, socket, conversationUpdates } = setup({
    findFirst: async (args: unknown) => {
      lookups.push(args);
      return EXISTING;
    },
    count: async () => 0,
    create: async () => {
      created += 1;
      return EXISTING;
    },
  });
  const { result, events } = await receive(prisma, io);
  assert.equal(result?.duplicate, true);
  assert.equal(result?.message.id, 'message-existing');
  assert.deepEqual((lookups[0] as { where: unknown }).where, { conversationId: 'conversation-1', channelMsgId: 'm-1' });
  assert.equal(created, 0);
  assert.equal(conversationUpdates.length, 0);
  assert.deepEqual(socket, []);
  assert.equal(events.some((e) => e.name === 'message.received'), false);
});

test('兩個相同的請求同時寫入：撞到唯一限制（P2002）時回傳另一個請求建立的訊息與 duplicate: true', async () => {
  let lookups = 0;
  const { prisma, io, socket, conversationUpdates } = setup({
    // 第一次是查重（還沒有），第二次是撞到唯一限制之後再查
    findFirst: async () => (++lookups === 1 ? null : EXISTING),
    count: async () => 0,
    create: async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    },
  });
  const { result, events } = await receive(prisma, io);
  assert.equal(result?.duplicate, true);
  assert.equal(result?.message.id, 'message-existing');
  assert.equal(conversationUpdates.length, 0);
  assert.deepEqual(socket, []);
  assert.equal(events.some((e) => e.name === 'message.received'), false);
});
