import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { ChannelPlugin, OutboundPayload } from '@open333crm/channel-plugins';
import { executeWorkerAutomationActions } from '#src/lib/automation-actions';

// Workers 缺少金鑰時拒絕解密（credential-encryption），測試自己設定金鑰
process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';
const ALGORITHM = 'aes-256-gcm';

function encryptCredentials(plain: Record<string, unknown>): string {
  const key = scryptSync(
    process.env.CREDENTIAL_ENCRYPTION_KEY!,
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
      receivedAt: new Date(Date.now() - 1_000).toISOString(),
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

async function testReplyFailureFallsBackToPush() {
  const sends: OutboundPayload[] = [];
  const plugin: ChannelPlugin = {
    channelType: 'LINE',
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (_to, payload) => {
      sends.push(payload);
      return sends.length === 1 ? { success: false, error: 'reply token expired' } : { success: true, channelMsgId: 'push-1' };
    },
  };
  const prisma = {
    conversation: {
      async findUnique() {
        return {
          id: 'conversation-1', tenantId: 'tenant-1',
          channel: { id: 'channel-1', channelType: 'LINE', isActive: true, credentialsEncrypted: encryptCredentials({ channelAccessToken: 'line-token' }) },
          contact: { channelIdentities: [{ channelId: 'channel-1', uid: 'line-user-1' }] },
        };
      },
      async update() { return {}; },
    },
    message: {
      async create(args: { data: { content: Record<string, unknown> } }) {
        return { id: 'message-1', conversationId: 'conversation-1', direction: 'OUTBOUND', senderType: 'SYSTEM', contentType: 'text', content: args.data.content, createdAt: new Date() };
      },
    },
  };
  await executeWorkerAutomationActions(prisma as any, { async publish() { return 1; } } as any, [{ type: 'send_message', params: { text: 'fallback' } }], {
    tenantId: 'tenant-1', conversationId: 'conversation-1', trigger: 'keyword.matched', replyToken: 'reply-token-1', receivedAt: new Date(Date.now() - 1_000).toISOString(), pluginRegistry: new Map([['LINE', plugin]]),
  });
  assert.equal(sends.length, 2);
  assert.equal(sends[0].content.strategy, 'reply');
  assert.equal(sends[1].content.strategy, 'push');
}

test('keyword matched line send message uses reply token', testKeywordMatchedLineSendMessageUsesReplyToken);
test('reply failure falls back to push', testReplyFailureFallsBackToPush);

// ── 自動化發券也在期限內以回覆方式送出（add-coupon-system A15 15.6、design D25）──

import { vi } from 'vitest';
import { COUPON_ID, RULE, TENANT, fakeCouponDb, fakeLinePlugin, fakeRedis } from '../support/fake-coupon-db.js';

vi.mock('bullmq', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Queue: class {
    async add() {
      return {};
    }
  },
}));

async function issueCouponAt(receivedAt: string, trigger = 'keyword.matched') {
  const { db } = fakeCouponDb();
  const { plugin, sends } = fakeLinePlugin();
  const { redis } = fakeRedis();
  await executeWorkerAutomationActions(db as never, redis as never, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }], {
    tenantId: TENANT,
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger,
    replyToken: 'reply-token-1',
    receivedAt,
    pluginRegistry: new Map([['LINE', plugin]]),
  });
  return sends;
}

test('自動化發券在期限內以回覆方式送出', async () => {
  const sends = await issueCouponAt(new Date(Date.now() - 3_000).toISOString());
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content.strategy, 'reply');
  assert.equal(sends[0].content.replyToken, 'reply-token-1');
});

test('超過回覆期限改用主動推送', async () => {
  const sends = await issueCouponAt(new Date(Date.now() - 45_000).toISOString());
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content.strategy, 'push');
});

test('加入好友觸發的發券也在期限內以回覆方式送出', async () => {
  const sends = await issueCouponAt(new Date(Date.now() - 3_000).toISOString(), 'contact.followed');
  assert.equal(sends[0].content.strategy, 'reply');
});

test('回覆權杖已被同一事件的其他動作用掉：發券改用主動推送，券照常發出', async () => {
  // PR #364 第五份審查第 17 項：歡迎訊息規則先用掉加入好友的 replyToken，加好友禮的發券再用同一個權杖會被
  // LINE 以 Invalid reply token 拒收。workers 送出層會改用 push（多用一次額度），券不會因此發不出去
  const { db, state } = fakeCouponDb();
  const { plugin, sends } = fakeLinePlugin({ replyFails: true });
  const { redis } = fakeRedis();
  await executeWorkerAutomationActions(db as never, redis as never, [{ type: 'issue_coupon', params: { couponId: COUPON_ID } }], {
    tenantId: TENANT,
    eventId: crypto.randomUUID(),
    ruleId: RULE.id,
    ruleName: RULE.name,
    conversationId: 'conv-1',
    contactId: 'contact-1',
    trigger: 'contact.followed',
    replyToken: 'used-reply-token',
    receivedAt: new Date(Date.now() - 3_000).toISOString(),
    pluginRegistry: new Map([['LINE', plugin]]),
  });
  assert.deepEqual(sends.map((s) => s.content.strategy), ['reply', 'push'], '回覆失敗後改推送一次');
  assert.equal(state.instances.length, 1);
  assert.equal(state.instances[0].deliveryPendingAt, null, '券已確認發出');
});
