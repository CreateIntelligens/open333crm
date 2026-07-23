import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { ChannelPlugin, OutboundPayload } from '@open333crm/channel-plugins';
import { executeWorkerAutomationActions } from '../lib/automation-actions';

const ALGORITHM = 'aes-256-gcm';

function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(
    process.env.CREDENTIAL_ENCRYPTION_KEY ?? 'fallback-open333crm-key',
    'open333crm-credentials',
    32,
  );
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(plain), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

async function testKeywordMatchedLineSendMessageUsesReplyToken() {
  const sends: Array<{ to: string; payload: OutboundPayload; credentials: Record<string, unknown> }> = [];
  const plugin: ChannelPlugin = {
    channelType: 'LINE',
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to, payload, credentials) => {
      sends.push({ to, payload, credentials });
      return { success: true, channelMsgId: 'line-message-1' };
    },
  };

  const createdMessages: Array<{ data: { content: Record<string, unknown> } }> = [];
  const prisma = {
    conversation: {
      async findUnique() {
        return {
          id: 'conversation-1',
          tenantId: 'tenant-1',
          channel: {
            id: 'channel-1',
            channelType: 'LINE',
            isActive: true,
            credentialsEncrypted: encryptCredentials({ channelAccessToken: 'line-token' }),
          },
          contact: {
            channelIdentities: [{ channelId: 'channel-1', uid: 'line-user-1' }],
          },
        };
      },
      async update() {
        return {};
      },
    },
    message: {
      async create(args: { data: { content: Record<string, unknown> } }) {
        createdMessages.push(args);
        return {
          id: 'message-1',
          conversationId: 'conversation-1',
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'text',
          content: args.data.content,
          createdAt: new Date('2026-07-23T00:00:00.000Z'),
        };
      },
    },
  };
  const redisPublisher = {
    async publish() {
      return 1;
    },
  };

  await executeWorkerAutomationActions(
    prisma as any,
    redisPublisher as any,
    [{ type: 'send_message', params: { text: '命中回覆' } }],
    {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      trigger: 'keyword.matched',
      replyToken: 'reply-token-1',
      pluginRegistry: new Map([['LINE', plugin]]),
    },
  );

  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, 'line-user-1');
  assert.equal(sends[0].credentials.channelAccessToken, 'line-token');
  assert.deepEqual(sends[0].payload, {
    contentType: 'text',
    content: {
      text: '命中回覆',
      strategy: 'reply',
      replyToken: 'reply-token-1',
    },
  });

  assert.equal(createdMessages.length, 1);
  assert.deepEqual(createdMessages[0].data.content, { text: '命中回覆' });
}

async function main() {
  await testKeywordMatchedLineSendMessageUsesReplyToken();
  console.log('automation-keyword-reply tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
