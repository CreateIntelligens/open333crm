/**
 * 記錄加入好友的次數（add-coupon-system A15 15.14；design D28；
 * spec automation-engine「記錄加入好友的次數」「加入好友事件」）。
 *
 * 以真實 Postgres 跑 processInboundMessage：client 用 app_admin（與正式環境 webhook 的 prismaAdmin 相同）。
 * LINE 的 follow／unfollow 事件經外掛解析後是 contentType 'follow'／'unfollow' 的入站訊息。
 * 首次招呼語的送出換成記錄呼叫的版本，不碰渠道 API。資料以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';

vi.mock('#src/modules/conversation/conversation.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#src/modules/conversation/conversation.service.js')>()),
  deliverToChannel: async () => true,
}));

import { loadEnvConfig } from '#src/config/env.js';
import { eventBus, type AppEvent } from '#src/events/event-bus.js';
import { processInboundMessage } from '#src/modules/webhook/webhook.service.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { testIo } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
const T = TENANT_A;
const MARK = `follow-track-${Date.now().toString(36)}`;
let channelId = '';

const received: AppEvent[] = [];
const onReceived = (e: AppEvent) => void received.push(e);

beforeAll(async () => {
  eventBus.subscribe('message.received', onReceived);
  channelId = (
    await owner.channel.create({
      data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted: 'x', isActive: true },
    })
  ).id;
});

beforeEach(() => {
  received.length = 0;
});

afterAll(async () => {
  eventBus.unsubscribe('message.received', onReceived);
  const convs = await owner.conversation.findMany({ where: { channelId }, select: { id: true } });
  await owner.message.deleteMany({ where: { conversationId: { in: convs.map((c) => c.id) } } });
  await owner.conversation.deleteMany({ where: { channelId } });
  const identities = await owner.channelIdentity.findMany({ where: { channelId }, select: { contactId: true } });
  await owner.channelIdentity.deleteMany({ where: { channelId } });
  await owner.contact.deleteMany({ where: { id: { in: identities.map((i) => i.contactId) }, tenantId: T } });
  await owner.channel.delete({ where: { id: channelId } });
  await Promise.all([owner.$disconnect(), admin.$disconnect()]);
});

let seq = 0;
async function lineEvent(uid: string, type: 'follow' | 'unfollow') {
  const parsed: ParsedWebhookMessage = {
    contactUid: uid,
    timestamp: new Date(),
    contentType: type,
    content: { systemEvent: type },
    rawPayload: { type, ...(type === 'follow' ? { replyToken: `reply-${MARK}-${seq++}` } : {}) },
  };
  return processInboundMessage(admin, testIo, {}, { id: channelId, channelType: 'LINE' }, T, parsed);
}

const identityOf = (uid: string) => owner.channelIdentity.findUniqueOrThrow({ where: { channelId_uid: { channelId, uid } } });
const followPayloads = () =>
  received
    .map((e) => e.payload as { contentType?: string; isFirstFollow?: unknown; replyToken?: string; receivedAt?: string })
    .filter((p) => p.contentType === 'follow');

test('第一次加入：「第一次加入」為是，加入次數為 1', async () => {
  const uid = `${MARK}-new`;
  await lineEvent(uid, 'follow');

  const identity = await identityOf(uid);
  assert.equal(identity.followCount, 1);
  assert.ok(identity.firstFollowedAt, '第一次加入的時間有值');
  assert.deepEqual(identity.lastFollowedAt, identity.firstFollowedAt);

  const [payload] = followPayloads();
  assert.equal(payload?.isFirstFollow, true);
  assert.match(payload?.replyToken ?? '', /^reply-/);
  assert.ok(payload?.receivedAt, '帶收到時間，讓動作在期限內用回覆方式送出');
});

test('封鎖後再加入：「第一次加入」為否，加入次數為 2，最後一次加入時間更新', async () => {
  const uid = `${MARK}-again`;
  await lineEvent(uid, 'follow');
  // 上個月加入
  const lastMonth = new Date(Date.now() - 30 * 86_400_000);
  await owner.channelIdentity.update({
    where: { channelId_uid: { channelId, uid } },
    data: { firstFollowedAt: lastMonth, lastFollowedAt: lastMonth },
  });
  received.length = 0;

  await lineEvent(uid, 'unfollow');
  await lineEvent(uid, 'follow');

  const identity = await identityOf(uid);
  assert.equal(identity.followCount, 2);
  assert.deepEqual(identity.firstFollowedAt, lastMonth);
  assert.ok(identity.lastFollowedAt && identity.lastFollowedAt > lastMonth, '最後一次加入時間更新');
  const payloads = followPayloads();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]!.isFirstFollow, false);
});

test('取消好友不算加入：unfollow 不增加加入次數，也不帶「第一次加入」', async () => {
  const uid = `${MARK}-unfollow`;
  await lineEvent(uid, 'follow');
  await lineEvent(uid, 'unfollow');
  const identity = await identityOf(uid);
  assert.equal(identity.followCount, 1);
  const unfollow = received.map((e) => e.payload as Record<string, unknown>).find((p) => p.contentType === 'unfollow');
  assert.ok(unfollow);
  assert.equal('isFirstFollow' in unfollow, false);
});

test('上線前就是好友的顧客：渠道身分回填了第一次加入時間（migration），封鎖後再加入「第一次加入」為否', async () => {
  const uid = `${MARK}-legacy`;
  const linkedAt = new Date('2026-01-15T00:00:00.000Z');
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK} 老朋友` } });
  // migration 20261023120000 把上線前的 LINE 渠道身分回填為 firstFollowedAt = linkedAt、加入次數 0
  await owner.channelIdentity.create({
    data: { contactId: contact.id, channelId, channelType: 'LINE', uid, linkedAt, firstFollowedAt: linkedAt },
  });

  await lineEvent(uid, 'unfollow');
  await lineEvent(uid, 'follow');

  const [payload] = followPayloads();
  assert.equal(payload?.isFirstFollow, false);
  const identity = await identityOf(uid);
  assert.deepEqual(identity.firstFollowedAt, linkedAt);
  assert.equal(identity.followCount, 1);
});
