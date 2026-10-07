/**
 * 客服與機器人在 WEBCHAT 對話的回覆推送到訪客的房間
 * （主規格 webchat-widget 的「Real-time message delivery to visitor」）。
 */
import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/open333crm';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-visitor-delivery-jwt-secret';
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

const published = vi.hoisted(() => [] as Array<{ channel: string; message: string }>);
vi.mock('ioredis', () => ({
  default: class {
    async publish(channel: string, message: string) {
      published.push({ channel, message });
      return 1;
    }
  },
}));

import { registerChannelPlugin, webchatPlugin } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { deliverToChannel, sendMessage } from '#src/modules/conversation/conversation.service.js';

// deliverToChannel 以 getConfig().REDIS_URL 建立 Redis 連線
loadEnvConfig();
registerChannelPlugin(webchatPlugin);

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';
const VISITOR_UID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  published.length = 0;
});

function webchatConversation() {
  return {
    id: 'conversation-1',
    tenantId: 'tenant-1',
    channelId: CHANNEL_ID,
    caseId: null,
    channel: {
      id: CHANNEL_ID,
      channelType: 'WEBCHAT',
      isActive: true,
      credentialsEncrypted: encryptCredentials({}),
    },
    contact: {
      id: 'contact-1',
      channelIdentities: [
        { channelId: 'another-channel', uid: 'uid-on-another-channel' },
        { channelId: CHANNEL_ID, uid: VISITOR_UID },
      ],
    },
  };
}

test('Agent replies to visitor：API 在 /visitor 命名空間對聯絡人的 WEBCHAT 身分房間送出 agent:message', async () => {
  const conversation = webchatConversation();
  const prisma = {
    conversation: {
      findFirst: async () => conversation,
      update: async () => ({}),
      findUnique: async () => ({
        ...conversation,
        contact: { ...conversation.contact, channelIdentities: [{ channelId: CHANNEL_ID, uid: VISITOR_UID }] },
      }),
    },
    message: {
      count: async () => 0,
      create: async (args: { data: Record<string, unknown> }) => ({
        id: 'message-1',
        ...args.data,
        createdAt: new Date('2026-10-07T00:00:00Z'),
        sender: null,
      }),
      update: async () => ({}),
    },
  };
  const visitorEmits: Array<{ namespace: string; room: string; event: string; data: Record<string, unknown> }> = [];
  const io = {
    to: () => ({ emit: () => true }),
    of: (namespace: string) => ({
      to: (room: string) => ({
        emit: (event: string, data: Record<string, unknown>) => {
          visitorEmits.push({ namespace, room, event, data });
          return true;
        },
      }),
    }),
  };

  await sendMessage(prisma as never, io as never, 'conversation-1', 'agent-1', 'tenant-1', {
    contentType: 'text',
    content: { text: 'hi visitor' },
  });

  assert.equal(visitorEmits.length, 1);
  assert.deepEqual(
    { namespace: visitorEmits[0]!.namespace, room: visitorEmits[0]!.room, event: visitorEmits[0]!.event },
    { namespace: '/visitor', room: `visitor:${CHANNEL_ID}:${VISITOR_UID}`, event: 'agent:message' },
  );
  assert.deepEqual(visitorEmits[0]!.data.content, { text: 'hi visitor' });
});

test('Bot replies to visitor：API 經 Redis socket 橋接，對 /visitor 命名空間與聯絡人的 WEBCHAT 身分房間發布 agent:message', async () => {
  const conversation = webchatConversation();
  const prisma = { conversation: { findUnique: async () => conversation } };

  const delivered = await deliverToChannel(prisma as never, 'conversation-1', 'bot reply');

  assert.equal(delivered, true);
  assert.equal(published.length, 1);
  assert.equal(published[0]!.channel, 'socket:emit');
  const message = JSON.parse(published[0]!.message);
  assert.equal(message.namespace, '/visitor');
  assert.equal(message.room, `visitor:${CHANNEL_ID}:${VISITOR_UID}`);
  assert.equal(message.event, 'agent:message');
  assert.deepEqual(message.data.content, { text: 'bot reply' });
});
