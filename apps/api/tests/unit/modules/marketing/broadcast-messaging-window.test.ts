/**
 * 群發依渠道訊息視窗略過送不到的人（change broadcast-messaging-window，spec broadcast-audience
 * 「有訊息視窗的渠道只發給視窗內互動過的人」「建立群發前可以看到可送達人數」）。
 * FB／IG 只能對 24 小時內互動過的人發一般訊息，送給其他人會被 Meta 擋下。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { registerChannelPlugin, type ChannelPlugin, type OutboundPayload } from '@open333crm/channel-plugins';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { executeBroadcast, previewBroadcastAudience } from '#src/modules/marketing/marketing.service.js';

process.env.CREDENTIAL_ENCRYPTION_KEY ||= 'test-credential-encryption-key-32-bytes!!';

const HOUR = 3600_000;
const TENANT = 'tenant-1';
const CHANNEL = 'ch-1';

function plugin(channelType: string, messagingWindowHours?: number) {
  const sends: string[] = [];
  registerChannelPlugin({
    channelType,
    messagingWindowHours,
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to: string, _m: OutboundPayload) => {
      sends.push(to);
      return { success: true, channelMsgId: `m-${sends.length}` };
    },
  } as ChannelPlugin);
  return sends;
}

/** lastInboundHoursAgo：每位聯絡人最後一次傳訊息是幾小時前，null 表示從沒傳過 */
function fixture(channelType: string, lastInboundHoursAgo: Array<number | null>, targetType = 'all') {
  const now = Date.now();
  const identities = lastInboundHoursAgo.map((_, i) => ({ contactId: `contact-${i}`, uid: `uid-${i}` }));
  const state: Record<string, unknown> = {
    id: 'bc-1', tenantId: TENANT, channelId: CHANNEL, materialId: 'mat-1', templateId: null,
    status: 'draft', targetType, targetConfig: {}, segmentId: null, campaignId: null, createdById: 'agent-1',
  };
  const recipients: Array<Record<string, unknown>> = [];
  const conversationQueries: Array<Record<string, any>> = [];
  const prisma = {
    broadcast: {
      findFirst: async () => state,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state, data),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => (Object.assign(state, data), { count: 1 }),
    },
    material: {
      findFirst: async () => ({ id: 'mat-1', tenantId: TENANT, contentType: 'fb_text', body: { text: 'hi' }, variables: [] }),
      update: async () => ({}),
    },
    channel: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.id === CHANNEL && where.tenantId === TENANT
          ? { id: CHANNEL, tenantId: TENANT, channelType, isActive: true, credentialsEncrypted: encryptCredentials({ pageAccessToken: 'x', channelAccessToken: 'x' }) }
          : null,
    },
    channelIdentity: { findMany: async () => identities },
    conversation: {
      // 依查詢條件回傳視窗內有顧客訊息的聯絡人
      findMany: async ({ where }: { where: Record<string, any> }) => {
        conversationQueries.push(where);
        const since: Date = where.messages.some.createdAt.gte;
        const ids: string[] = where.contactId.in;
        return ids
          .filter((id) => {
            const hours = lastInboundHoursAgo[Number(id.split('-')[1])];
            return hours !== null && now - hours * HOUR >= since.getTime();
          })
          .map((contactId) => ({ contactId }));
      },
    },
    broadcastRecipient: {
      create: async ({ data }: { data: Record<string, unknown> }) => (recipients.push(data), data),
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => (recipients.push(...data), { count: data.length }),
    },
    broadcastDeliveryAttempt: { findFirst: async () => null, create: async ({ data }: any) => ({ id: 'a', ...data }), updateMany: async () => ({ count: 1 }) },
    contactTag: { findMany: async () => [] },
    contact: { findMany: async () => [], findFirst: async () => null, findUnique: async () => null },
    contactAttribute: { findMany: async () => [] },
  };
  return { prisma: prisma as never, state, recipients, conversationQueries };
}

const io = { to: () => ({ emit() {} }) } as never;

test('FB 群發略過超過 24 小時沒互動的人', async () => {
  const sends = plugin('FB', 24);
  const f = fixture('FB', [2, 30, null]);
  await executeBroadcast(f.prisma, io, 'bc-1');
  assert.deepEqual(sends, ['uid-0']);
  assert.equal(f.state.totalCount, 3);
  assert.equal(f.state.successCount, 1);
  assert.equal(f.state.skippedCount, 2);
  assert.equal(f.state.status, 'completed');
  assert.deepEqual(f.recipients.map((r) => r.contactId), ['contact-0']);
  const q = f.conversationQueries[0];
  assert.equal(q.tenantId, TENANT);
  assert.equal(q.channelId, CHANNEL);
  assert.equal(q.messages.some.direction, 'INBOUND');
  assert.equal(q.messages.some.senderType, 'CONTACT');
});

test('全部在視窗外時群發失敗', async () => {
  const sends = plugin('FB', 24);
  const f = fixture('FB', [25, null]);
  await assert.rejects(executeBroadcast(f.prisma, io, 'bc-1'));
  assert.deepEqual(sends, []);
  assert.equal(f.state.status, 'failed');
  assert.equal(f.state.skippedCount, 2);
  assert.match(String(f.state.failureReason), /2 位/);
  assert.match(String(f.state.failureReason), /24 小時/);
});

test('沒有訊息視窗的渠道不略過', async () => {
  const sends = plugin('LINE_TEST');
  const f = fixture('LINE_TEST', [48, null]);
  await executeBroadcast(f.prisma, io, 'bc-1');
  assert.deepEqual(sends, ['uid-0', 'uid-1']);
  assert.equal(f.state.skippedCount, 0);
  assert.equal(f.conversationQueries.length, 0, '沒有視窗就不查互動時間');
});

test('預估 FB 群發的可送達人數', async () => {
  plugin('FB', 24);
  const f = fixture('FB', [1, 30, null]);
  const result = await previewBroadcastAudience(f.prisma, TENANT, { channelId: CHANNEL, targetType: 'all' });
  assert.deepEqual(result, { matched: 3, reachable: 1, messagingWindowHours: 24 });
});

test('預估 LINE 群發', async () => {
  plugin('LINE_TEST');
  const f = fixture('LINE_TEST', [48, null]);
  const result = await previewBroadcastAudience(f.prisma, TENANT, { channelId: CHANNEL, targetType: 'all' });
  assert.deepEqual(result, { matched: 2, reachable: 2, messagingWindowHours: null });
});

test('受眾設定不完整', async () => {
  plugin('FB', 24);
  const f = fixture('FB', [1]);
  await assert.rejects(
    previewBroadcastAudience(f.prisma, TENANT, { channelId: CHANNEL, targetType: 'tags', targetConfig: {} }),
    (err: any) => err.code === 'INVALID_AUDIENCE' && err.statusCode === 400,
  );
});

test('預估別的租戶的渠道回 404', async () => {
  plugin('FB', 24);
  const f = fixture('FB', [1]);
  await assert.rejects(
    previewBroadcastAudience(f.prisma, 'tenant-other', { channelId: CHANNEL, targetType: 'all' }),
    (err: any) => err.statusCode === 404,
  );
});
