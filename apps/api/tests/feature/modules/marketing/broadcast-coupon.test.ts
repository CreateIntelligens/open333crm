/**
 * 附券廣播（add-coupon-system A15 15.19、15.20；design D29、D31）。
 *
 * 引擎以 app_tenant 連線執行（RLS 生效）；建立與清理資料用 owner 連線。
 * 渠道外掛換成記錄用的替身（不碰 LINE／Meta），票券連結用記憶體儲存。
 * 本檔建立的聯絡人、渠道、券、廣播以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, type ChannelPlugin, type OutboundPayload } from '@open333crm/channel-plugins';
import { readWalletToken } from '@open333crm/core';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { openWalletSessionFlow } from '#src/modules/coupon/coupon-wallet.flow.js';
import { signFanDeviceToken } from '#src/modules/portal/portal-auth.service.js';
import marketingRoutes from '#src/modules/marketing/marketing.routes.js';
import { setupBroadcastScheduler } from '#src/modules/marketing/broadcast.scheduler.js';
import { createBroadcast, previewBroadcastAudience } from '#src/modules/marketing/marketing.service.js';
import {
  claimCouponBroadcast,
  finalizeCouponBroadcast,
  recordProgress,
  getCouponBroadcastSummary,
  prepareRecipients,
  queueCouponBroadcast,
  reserveRecipient,
  type CouponBroadcastPlan,
} from '#src/modules/marketing/broadcast-coupon.service.js';
import { runCouponBroadcast, type CouponBroadcastDeps } from '#src/modules/marketing/broadcast-coupon.flow.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `bc-coupon-${Date.now().toString(36)}`;
const creatorId = randomUUID();
const WEB = 'https://crm.example.com';

// ── 渠道外掛替身 ─────────────────────────────────────────────────────────

interface Sent {
  channelType: string;
  to: string;
  payload: OutboundPayload;
}
const sent: Sent[] = [];
/** 這些收件人的所有訊息都被拒收（封鎖官方帳號） */
const blocked = new Set<string>();
/** 這些收件人只有發券文字被拒收（素材送達、帶連結的那則送不出） */
const rejectCouponText = new Set<string>();
/** LINE 本月剩餘額度；null 表示沒有上限 */
let lineQuotaLeft: number | null = null;

const isCouponText = (p: { content: Record<string, unknown> }) =>
  typeof p.content.text === 'string' && p.content.text.includes('/coupon/open/');

function mockPlugin(channelType: string, extra: Partial<ChannelPlugin> = {}): ChannelPlugin {
  return {
    channelType,
    verifySignature: () => true,
    parseWebhook: async () => [],
    getProfile: async (uid: string) => ({ uid, displayName: uid }),
    sendMessage: async (to: string, payload: OutboundPayload) => {
      sent.push({ channelType, to, payload });
      if (blocked.has(to)) return { success: false, error: 'blocked' };
      const all = [payload, ...(payload.extraMessages ?? [])];
      if (rejectCouponText.has(to) && all.some(isCouponText)) return { success: false, error: 'rejected' };
      return { success: true, channelMsgId: `m-${sent.length}` };
    },
    ...extra,
  } as ChannelPlugin;
}

registerChannelPlugin(mockPlugin('LINE', {
  maxMessagesPerSend: 5,
  extensions: {
    analytics: {
      getDeliveryStats: async () => ({}),
      getMessageQuota: async () =>
        lineQuotaLeft === null ? { totalUsage: 10 } : { totalUsage: 1000 - lineQuotaLeft, maxMessages: 1000 },
    },
  },
} as Partial<ChannelPlugin>));
registerChannelPlugin(mockPlugin('FB', { messagingWindowHours: 24 } as Partial<ChannelPlugin>));

const store = memBindingStore();
const deps: CouponBroadcastDeps = { prisma, io: testIo, store, webBaseUrl: WEB };

/** 訊息裡的票券連結權杖 */
function tokensIn(payloads: Array<{ content: Record<string, unknown> }>): string[] {
  const out: string[] = [];
  for (const p of payloads) {
    const text = JSON.stringify(p.content);
    for (const m of text.matchAll(/\/coupon\/open\/([A-Za-z0-9_-]{40,64})/g)) out.push(m[1]);
  }
  return out;
}
const sentTo = (uid: string) => sent.filter((s) => s.to === uid);
const allMessages = (s: Sent) => [s.payload, ...(s.payload.extraMessages ?? [])];

// ── 資料 ────────────────────────────────────────────────────────────────

let lineChannel = '';
let fbChannel = '';
let agentId = '';
let roleId = '';
let tagId = '';

interface Person {
  contactId: string;
  uid: string;
}

let seq = 0;
async function person(
  name: string,
  opts: { channel?: 'LINE' | 'FB'; conversation?: boolean; inboundHoursAgo?: number; verified?: boolean; tag?: boolean } = {},
): Promise<Person> {
  const channelType = opts.channel ?? 'LINE';
  const channelId = channelType === 'LINE' ? lineChannel : fbChannel;
  const contact = await owner.contact.create({
    data: {
      tenantId: T,
      displayName: `${MARK}-${name}`,
      // 依名單順序：建立時間遞增
      createdAt: new Date(Date.now() + seq++),
      ...(opts.verified ? { identityVerifiedAt: new Date(), identityVerifiedVia: 'phone' } : {}),
    },
  });
  const uid = `${MARK}-${name}`;
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId, channelType, uid, profileName: name } });
  if (opts.conversation !== false) {
    const conv = await owner.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId, channelType } });
    if (opts.inboundHoursAgo !== undefined) {
      await owner.message.create({
        data: {
          conversationId: conv.id, direction: 'INBOUND', senderType: 'CONTACT', contentType: 'text',
          content: { text: '你好' }, sequence: 1, createdAt: new Date(Date.now() - opts.inboundHoursAgo * 3600_000),
        },
      });
    }
  }
  if (opts.tag) await owner.contactTag.create({ data: { contactId: contact.id, tagId, addedBy: 'agent' } });
  return { contactId: contact.id, uid };
}

async function coupon(name: string, data: Record<string, unknown> = {}) {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${name}`.slice(0, 30), couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'BC',
      redeemMode: 'SELF', perContactLimit: 1,
      ...data,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  return c.id;
}

async function material(channelType: 'line' | 'fb', text: string) {
  const m = await owner.material.create({
    data: { tenantId: T, name: `${MARK}-素材`, channelType, contentType: 'text', body: { text }, createdById: creatorId },
  });
  return m.id;
}

/** 建立附券廣播並排入發送（與「立即發送」同一個路徑） */
async function broadcast(params: {
  couponId: string;
  materialId?: string;
  channel?: 'LINE' | 'FB';
  contacts?: Person[];
  segmentId?: string;
  name?: string;
}) {
  const b = await runInTenant(prisma, T, (ctx) =>
    createBroadcast(ctx.tx, T, agentId, {
      name: params.name ?? `${MARK} 秋季廣播`,
      materialId: params.materialId,
      channelId: params.channel === 'FB' ? fbChannel : lineChannel,
      couponId: params.couponId,
      ...(params.segmentId
        ? { targetType: 'segment' as const, segmentId: params.segmentId }
        : { targetType: 'contacts' as const, targetConfig: { contactIds: (params.contacts ?? []).map((p) => p.contactId) } }),
    }));
  await runInTenant(prisma, T, (ctx) => queueCouponBroadcast(ctx, b.id));
  return b.id;
}

const run = (broadcastId: string) => runCouponBroadcast(deps, T, broadcastId);
const instancesOf = (p: Person, couponId: string) =>
  owner.couponInstance.findMany({ where: { tenantId: T, couponId, contactId: p.contactId } });
const recipientOf = (broadcastId: string, p: Person) =>
  owner.broadcastRecipient.findFirst({ where: { broadcastId, contactId: p.contactId } });

beforeAll(async () => {
  const credentialsEncrypted = encryptCredentials({ channelAccessToken: 'x', pageAccessToken: 'x' });
  const mkChannel = (channelType: 'LINE' | 'FB') =>
    owner.channel.create({ data: { tenantId: T, channelType, displayName: `${MARK}-${channelType}`, credentialsEncrypted, isActive: true } });
  lineChannel = (await mkChannel('LINE')).id;
  fbChannel = (await mkChannel('FB')).id;
  agentId = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '行銷小美', passwordHash: 'x' } })).id;
  tagId = (await owner.tag.create({ data: { tenantId: T, name: `${MARK}-分眾`, scope: 'CONTACT' } })).id;
  roleId = (await owner.role.create({
    data: {
      tenantId: T, slug: MARK, name: MARK,
      permissions: { create: ['marketing.view', 'marketing.manage', 'marketing.broadcast'].map((permissionCode) => ({ permissionCode })) },
    },
  })).id;
});

beforeEach(() => {
  sent.length = 0;
  blocked.clear();
  rejectCouponText.clear();
  lineQuotaLeft = null;
});

afterAll(async () => {
  const broadcasts = await owner.broadcast.findMany({ where: { tenantId: T, name: { startsWith: MARK } }, select: { id: true } });
  await owner.broadcastRecipient.deleteMany({ where: { broadcastId: { in: broadcasts.map((b) => b.id) } } });
  await owner.broadcast.deleteMany({ where: { id: { in: broadcasts.map((b) => b.id) } } });
  const contacts = await owner.contact.findMany({ where: { tenantId: T, displayName: { startsWith: MARK } }, select: { id: true } });
  const contactIds = contacts.map((c) => c.id);
  await owner.couponInstance.deleteMany({ where: { tenantId: T, coupon: { createdById: creatorId } } });
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.segment.deleteMany({ where: { tenantId: T, name: { startsWith: MARK } } });
  await owner.message.deleteMany({ where: { conversation: { contactId: { in: contactIds } } } });
  await owner.conversation.deleteMany({ where: { contactId: { in: contactIds } } });
  await owner.contactTag.deleteMany({ where: { contactId: { in: contactIds } } });
  await owner.channelIdentity.deleteMany({ where: { contactId: { in: contactIds } } });
  await owner.contact.deleteMany({ where: { id: { in: contactIds } } });
  await owner.shortLink.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.material.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.tag.deleteMany({ where: { id: tagId } });
  await owner.role.deleteMany({ where: { id: roleId } });
  await owner.agent.deleteMany({ where: { tenantId: T, email: `${MARK}@example.com` } });
  await owner.channel.deleteMany({ where: { id: { in: [lineChannel, fbChannel] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

// ── 廣播可以附上優惠券 ────────────────────────────────────────────────────

describe('廣播可以附上優惠券', () => {
  it('素材含票券連結變數', async () => {
    const couponId = await coupon(`${MARK}秋A`);
    const a = await person('var-a');
    const id = await broadcast({ couponId, materialId: await material('line', '秋季優惠：{{coupon.url}}'), contacts: [a] });
    await run(id);
    const mine = sentTo(a.uid);
    assert.equal(mine.length, 1, '只送一次');
    assert.equal(allMessages(mine[0]).length, 1, '只有一則訊息');
    assert.match(String(mine[0].payload.content.text), /^秋季優惠：https:\/\/crm\.example\.com\/coupon\/open\//);
    const [token] = tokensIn(allMessages(mine[0]));
    const payload = await readWalletToken(store, token);
    const [instance] = await instancesOf(a, couponId);
    assert.equal(payload?.instanceId, instance.id, '連結是甲自己的券');
    assert.equal(payload?.contactId, a.contactId);
  });

  it('素材沒有票券連結變數', async () => {
    const couponId = await coupon(`${MARK}秋B`);
    const a = await person('novar-a');
    const id = await broadcast({ couponId, materialId: await material('line', '秋季優惠開跑'), contacts: [a] });
    await run(id);
    const mine = sentTo(a.uid);
    // LINE 的兩則以同一次推送送出
    assert.equal(mine.length, 1);
    const messages = allMessages(mine[0]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content.text, '秋季優惠開跑', '先送素材');
    assert.ok(isCouponText(messages[1]), '再送帶連結的發券文字');
    const [token] = tokensIn(messages);
    assert.equal((await readWalletToken(store, token))?.contactId, a.contactId);
  });

  it('沒有選素材', async () => {
    const couponId = await coupon(`${MARK}秋C`);
    const a = await person('nomat-a');
    const id = await broadcast({ couponId, contacts: [a] });
    await run(id);
    const mine = sentTo(a.uid);
    assert.equal(mine.length, 1);
    const messages = allMessages(mine[0]);
    assert.equal(messages.length, 1, '只送預設的發券文字');
    assert.match(String(messages[0].content.text), /為您準備了一張優惠券/);
    assert.equal(tokensIn(messages).length, 1);
  });
});

// ── 附券廣播每位收件人各得一張券 ──────────────────────────────────────────

describe('附券廣播每位收件人各得一張券', () => {
  it('兩位收件人收到不同的連結', async () => {
    const couponId = await coupon(`${MARK}秋D`);
    const a = await person('two-a');
    const b = await person('two-b');
    const id = await broadcast({ couponId, contacts: [a, b], name: `${MARK} 雙人廣播` });
    await run(id);
    const [ta] = tokensIn(allMessages(sentTo(a.uid)[0]));
    const [tb] = tokensIn(allMessages(sentTo(b.uid)[0]));
    assert.notEqual(ta, tb);
    const [ia] = await instancesOf(a, couponId);
    const [ib] = await instancesOf(b, couponId);
    assert.equal((await readWalletToken(store, ta))?.instanceId, ia.id);
    assert.equal((await readWalletToken(store, tb))?.instanceId, ib.id);
    for (const i of [ia, ib]) {
      assert.equal(i.issuedVia, 'broadcast');
      assert.equal(i.issuedRefId, id);
      assert.equal(i.issuedSourceName, `${MARK} 雙人廣播`);
      assert.equal(i.deliveryPendingAt, null, '送出成功後確認');
    }
    assert.equal((await recipientOf(id, a))?.couponInstanceId, ia.id, '收件紀錄記下他的券');
    assert.equal((await recipientOf(id, a))?.deliveryStatus, 'sent');
  });

  it('帶連結的訊息送出成功才確認', async () => {
    const couponId = await coupon(`${MARK}秋E`);
    const b = await person('fb-b', { channel: 'FB', inboundHoursAgo: 1 });
    rejectCouponText.add(b.uid);
    const id = await broadcast({ couponId, channel: 'FB', materialId: await material('fb', '秋季優惠開跑'), contacts: [b] });
    await run(id);
    // FB 分兩次呼叫：素材送達，發券文字被拒收
    const mine = sentTo(b.uid);
    assert.equal(mine.length, 2);
    assert.equal(mine[0].payload.content.text, '秋季優惠開跑');
    assert.equal((await instancesOf(b, couponId)).length, 0, '券作廢並歸還名額');
    const r = await recipientOf(id, b);
    assert.equal(r?.deliveryStatus, 'failed');
    assert.equal(r?.skipReason, 'COUPON_MESSAGE_FAILED', '原因註明素材已送達、優惠券訊息送不出');
    assert.equal(r?.couponInstanceId, null);
  });

  it('素材送不出時不送發券文字', async () => {
    const couponId = await coupon(`${MARK}秋F`);
    const c = await person('fb-c', { channel: 'FB', inboundHoursAgo: 1 });
    blocked.add(c.uid);
    const id = await broadcast({ couponId, channel: 'FB', materialId: await material('fb', '秋季優惠開跑'), contacts: [c] });
    await run(id);
    assert.equal(sentTo(c.uid).length, 1, '素材送不出就不送發券文字');
    assert.equal((await instancesOf(c, couponId)).length, 0);
    const r = await recipientOf(id, c);
    assert.equal(r?.deliveryStatus, 'failed');
    assert.equal(r?.skipReason, 'DELIVERY_FAILED');
  });

  it('收件人沒有對話', async () => {
    const couponId = await coupon(`${MARK}秋G`);
    const a = await person('noconv-a', { conversation: false, verified: true });
    const id = await broadcast({ couponId, contacts: [a] });
    await run(id);
    const [token] = tokensIn(allMessages(sentTo(a.uid)[0]));
    assert.ok(token, '收到票券連結');
    const opened = await openWalletSessionFlow({ prisma, io: testIo, store }, token, [signFanDeviceToken(a.contactId, T)]);
    assert.equal(opened.status, 'ok', '連結可以開啟');
  });
});

// ── 附券廣播的跳過與回報 ──────────────────────────────────────────────────

describe('附券廣播的跳過與回報', () => {
  it('名額不足', async () => {
    const couponId = await coupon(`${MARK}秋H`, { totalLimit: 2 });
    const a = await person('quota-a');
    const b = await person('quota-b');
    const c = await person('quota-c');
    const id = await broadcast({ couponId, contacts: [a, b, c] });
    await run(id);
    assert.equal(sentTo(a.uid).length, 1);
    assert.equal(sentTo(b.uid).length, 1);
    assert.equal(sentTo(c.uid).length, 0, '第 3 位沒有收到訊息');
    const r = await recipientOf(id, c);
    assert.equal(r?.deliveryStatus, 'skipped');
    assert.equal(r?.skipReason, 'TOTAL_LIMIT_REACHED');
    const row = await owner.broadcast.findFirst({ where: { id } });
    assert.equal(row?.couponIssuedCount, 2);
    const summary = await runInTenant(prisma, T, (ctx) => getCouponBroadcastSummary(ctx, id));
    assert.equal(summary.issued, 2);
    assert.deepEqual(summary.skipped, { TOTAL_LIMIT_REACHED: 1 });
  });

  it('收件人已達每人上限', async () => {
    const couponId = await coupon(`${MARK}秋I`);
    const a = await person('limit-a');
    await runInTenant(prisma, T, (ctx) => issueCoupons(ctx, couponId, { contactIds: [a.contactId], issuedVia: 'api' }));
    const id = await broadcast({ couponId, contacts: [a] });
    await run(id);
    assert.equal(sentTo(a.uid).length, 0, '甲沒有收到訊息');
    const r = await recipientOf(id, a);
    assert.equal(r?.deliveryStatus, 'skipped');
    assert.equal(r?.skipReason, 'PER_CONTACT_LIMIT_REACHED');
  });

  it('收件人封鎖官方帳號', async () => {
    const couponId = await coupon(`${MARK}秋J`);
    const b = await person('block-b');
    blocked.add(b.uid);
    const id = await broadcast({ couponId, contacts: [b] });
    await run(id);
    assert.equal((await instancesOf(b, couponId)).length, 0, '券作廢並歸還名額');
    assert.equal((await recipientOf(id, b))?.deliveryStatus, 'failed');
  });
});

// ── 依發券場景選用發送策略 ────────────────────────────────────────────────

it('分眾群發', async () => {
  const couponId = await coupon(`${MARK}秋K`, { perContactLimit: 1 });
  const people = [await person('seg-a', { tag: true }), await person('seg-b', { tag: true }), await person('seg-c', { tag: true })];
  const segment = await owner.segment.create({
    data: {
      tenantId: T, name: `${MARK}-分眾`,
      rules: { conditions: [{ field: 'tag', operator: 'eq', value: tagId }], logic: 'AND' },
    },
  });
  const id = await broadcast({ couponId, segmentId: segment.id });
  await run(id);
  for (const p of people) {
    const mine = sentTo(p.uid);
    assert.equal(mine.length, 1, '每位收件人各一次主動推送');
    assert.notEqual(mine[0].payload.content.strategy, 'multicast', '不使用 multicast');
    assert.equal(tokensIn(allMessages(mine[0])).length, 1, '帶自己的票券連結');
  }
});

// ── 附券廣播發送前檢查名額與訊息額度 ──────────────────────────────────────

describe('附券廣播發送前檢查名額與訊息額度', () => {
  it('預覽顯示剩餘名額', async () => {
    const couponId = await coupon(`${MARK}秋L`, { totalLimit: 3 });
    const held = await person('preview-held');
    await runInTenant(prisma, T, (ctx) => issueCoupons(ctx, couponId, { contactIds: [held.contactId], issuedVia: 'api' }));
    const others = [await person('preview-a'), await person('preview-b'), await person('preview-c')];
    const result = await runInTenant(prisma, T, (ctx) =>
      previewBroadcastAudience(ctx.tx, T, {
        channelId: lineChannel,
        targetType: 'contacts',
        targetConfig: { contactIds: [held, ...others].map((p) => p.contactId) },
        couponId,
      }));
    assert.equal(result.reachable, 4);
    assert.equal(result.coupon?.remaining, 2, '剩餘名額');
    assert.equal(result.coupon?.limitReached, 1, '已達每人上限的人數');
  });

  it('預覽與建立用相同的券檢查：非進行中或客服補償券回相同的錯誤', async () => {
    // PR #364 第二輪審查：預覽原本只確認券存在，暫停的券或客服補償券仍算出人數，按建立才被擋
    const p = await person('preview-check');
    const preview = (couponId: string, couponIssuedVia?: string) =>
      runInTenant(prisma, T, (ctx) =>
        previewBroadcastAudience(ctx.tx, T, {
          channelId: lineChannel, targetType: 'contacts', targetConfig: { contactIds: [p.contactId] }, couponId,
          ...(couponIssuedVia ? { couponIssuedVia } : {}),
        }));
    const create = (couponId: string) =>
      runInTenant(prisma, T, (ctx) =>
        createBroadcast(ctx.tx, T, agentId, {
          name: `${MARK} 預覽檢查`, channelId: lineChannel, targetType: 'contacts', targetConfig: { contactIds: [p.contactId] }, couponId,
        }));
    const errorOf = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return null;
      } catch (err) {
        return { code: (err as { code?: string }).code, message: (err as Error).message };
      }
    };

    const paused = await coupon(`${MARK}秋暫停`);
    await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), paused, 'PAUSED'));
    const pausedError = await errorOf(() => preview(paused));
    assert.deepEqual(pausedError, { code: 'INVALID_COUPON', message: '只能附上進行中的優惠券' });
    assert.deepEqual(pausedError, await errorOf(() => create(paused)), '與建立時的錯誤相同');

    const service = await coupon(`${MARK}補償`, { purpose: 'SERVICE' });
    const serviceError = await errorOf(() => preview(service));
    assert.deepEqual(serviceError, { code: 'INVALID_COUPON', message: '廣播只能附上行銷券，客服補償券請在對話中發送' });
    assert.deepEqual(serviceError, await errorOf(() => create(service)));

    // 券詳情頁的批次發放允許客服補償券（design D31）
    const batch = await preview(service, 'batch');
    assert.equal(batch.reachable, 1);
  });

  it('LINE 訊息額度不足', async () => {
    const couponId = await coupon(`${MARK}秋M`);
    const a = await person('lq-a');
    const b = await person('lq-b');
    lineQuotaLeft = 1;
    const id = await broadcast({ couponId, contacts: [a, b] });
    await run(id);
    assert.equal(sent.length, 0, '沒有送出任何訊息');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '沒有建立任何券');
    const row = await owner.broadcast.findFirst({ where: { id } });
    assert.equal(row?.status, 'failed');
    assert.equal(row?.failureCode, 'LINE_QUOTA_INSUFFICIENT');
    assert.ok(row?.failureReason, '後台看得到原因');
  });
});

// ── 附券廣播在背景執行且重送不重複發券 ────────────────────────────────────

describe('附券廣播在背景執行且重送不重複發券', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
    app.decorate('prisma', prisma);
    app.decorate('prismaAdmin', owner);
    app.decorate('io', testIo);
    app.decorate('authenticate', async (request: FastifyRequest) => {
      request.agent = { id: agentId, tenantId: T, role: 'ADMIN', roleId } as never;
      (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
    });
    await app.register(marketingRoutes, { prefix: '/api/v1/marketing' });
    await app.ready();
  });
  afterAll(() => app.close());

  it('立即發送不等待完成', async () => {
    const couponId = await coupon(`${MARK}秋N`);
    const a = await person('queue-a');
    const b = await runInTenant(prisma, T, (ctx) =>
      createBroadcast(ctx.tx, T, agentId, {
        name: `${MARK} 立即發送`, channelId: lineChannel, couponId, targetType: 'contacts', targetConfig: { contactIds: [a.contactId] },
      }));
    const res = await app.inject({ method: 'POST', url: `/api/v1/marketing/broadcasts/${b.id}/send` });
    assert.equal(res.statusCode, 202, res.body);
    assert.equal(res.json().data.status, 'scheduled', '回應廣播已排入發送');
    assert.equal(sent.length, 0, 'HTTP 請求內不發送');
    const row = await owner.broadcast.findFirst({ where: { id: b.id } });
    assert.equal(row?.status, 'scheduled');
    assert.ok(row?.scheduledAt && row.scheduledAt.getTime() <= Date.now(), '排程立即執行');
  });

  it('重送跳過已處理的收件人', async () => {
    const couponId = await coupon(`${MARK}秋O`);
    const a = await person('resend-a');
    const b = await person('resend-b');
    const c = await person('resend-c');
    const id = await broadcast({ couponId, contacts: [a, b] });
    await run(id);
    assert.equal(sent.length, 2);
    // 模擬發送到一半中斷：狀態停在發送中、超過 5 分鐘沒有進度；名單多了丙
    await owner.$executeRaw`UPDATE broadcasts SET status = 'sending', "updatedAt" = now() - interval '10 minutes',
      "targetConfig" = ${JSON.stringify({ contactIds: [a.contactId, b.contactId, c.contactId] })}::jsonb WHERE id = ${id}::uuid`;
    const res = await app.inject({ method: 'POST', url: `/api/v1/marketing/broadcasts/${id}/send` });
    assert.equal(res.statusCode, 202, res.body);
    await run(id);
    assert.equal(sentTo(a.uid).length, 1, '甲沒有收到第二則訊息');
    assert.equal(sentTo(b.uid).length, 1);
    assert.equal(sentTo(c.uid).length, 1, '丙這次才收到');
    assert.equal((await instancesOf(a, couponId)).length, 1, '甲沒有拿到第二張券');
    assert.equal((await instancesOf(c, couponId)).length, 1);

    // 兩道防線各自檢查：名單略過已有收件紀錄的人；保留時再查一次（並行的兩次發送）
    const row = await owner.broadcast.findFirstOrThrow({ where: { id } });
    const plan = {
      broadcast: { ...row, couponIssuedVia: 'broadcast' },
      coupon: { id: couponId, name: '', status: 'ACTIVE', claimTagId: null, claimTagTtlDays: null },
    } as unknown as CouponBroadcastPlan;
    const prepared = await runInTenant(prisma, T, (ctx) => prepareRecipients(ctx, plan, undefined));
    assert.deepEqual(prepared.pending, [], '已處理的人不在這次的名單');
    const again = await runInTenant(prisma, T, (ctx) =>
      reserveRecipient(ctx, plan, { contactId: a.contactId, uid: a.uid, channelIdentityId: randomUUID() }));
    assert.equal(again.kind, 'already', '保留時查到收件紀錄就不發券');
    assert.equal((await instancesOf(a, couponId)).length, 1);
  });

  it('重新排入後，舊的執行不能再保留券或寫入進度與結果', async () => {
    // PR #364 第三輪審查第 3 項：舊的執行停滯超過 5 分鐘（例如渠道逾時）被重新排入，但它其實還在跑。
    // 原本兩個執行都能繼續發券、更新進度與最終狀態，後寫入的覆蓋先寫入的
    const couponId = await coupon(`${MARK}秋R`);
    const a = await person('rerun-a');
    const b = await person('rerun-b');
    const id = await broadcast({ couponId, contacts: [a, b] });
    const t0 = Date.now();
    await runInTenant(prisma, T, (ctx) => queueCouponBroadcast(ctx, id, t0));
    const first = await runInTenant(prisma, T, (ctx) => claimCouponBroadcast(ctx, id, t0));
    assert.ok(first.ok);
    // 舊的執行停滯：管理者重新發送，新的執行搶占
    await owner.$executeRaw`UPDATE broadcasts SET "updatedAt" = now() - interval '10 minutes' WHERE id = ${id}::uuid`;
    await runInTenant(prisma, T, (ctx) => queueCouponBroadcast(ctx, id, t0 + 1000));
    const second = await runInTenant(prisma, T, (ctx) => claimCouponBroadcast(ctx, id, t0 + 1000));
    assert.ok(second.ok);

    const stale = first.ok ? first.plan : (null as never);
    const reservation = await runInTenant(prisma, T, (ctx) =>
      reserveRecipient(ctx, stale, { contactId: a.contactId, uid: a.uid, channelIdentityId: randomUUID() }));
    assert.equal(reservation.kind, 'superseded', '舊的執行不再保留券');
    assert.equal((await instancesOf(a, couponId)).length, 0);

    await runInTenant(prisma, T, (ctx) => recordProgress(ctx, id, stale.broadcast.runStartedAt));
    const result = await runInTenant(prisma, T, (ctx) => finalizeCouponBroadcast(ctx, stale, { now: t0 + 2000 }));
    assert.equal(result.status, 'superseded');
    const row = await owner.broadcast.findFirst({ where: { id } });
    assert.equal(row?.status, 'sending', '舊的執行沒有把廣播標成結束');
    assert.equal(row?.sentAt?.getTime(), t0 + 1000, '仍是新的執行');
  });

  it('中斷時發送中的收件人不重送，標為發送中斷', async () => {
    // PR #364 審查第 5 項：上次保留券後、送出前程式結束，收件紀錄停在 pending。
    // 重送不能再送（可能已送達，送兩次比漏送更糟，design D29），但也不能一直顯示「發送中」
    const couponId = await coupon(`${MARK}秋P`);
    const a = await person('interrupt-a');
    const b = await person('interrupt-b');
    const id = await broadcast({ couponId, contacts: [a, b] });
    await owner.broadcastRecipient.create({ data: { broadcastId: id, contactId: a.contactId, deliveryStatus: 'pending' } });
    await owner.$executeRaw`UPDATE broadcasts SET status = 'sending', "updatedAt" = now() - interval '10 minutes' WHERE id = ${id}::uuid`;
    await runInTenant(prisma, T, (ctx) => queueCouponBroadcast(ctx, id));
    const result = await run(id);

    assert.equal(sentTo(a.uid).length, 0, '甲不重送');
    assert.equal(sentTo(b.uid).length, 1);
    const rowA = await recipientOf(id, a);
    assert.equal(rowA?.deliveryStatus, 'failed');
    assert.equal(rowA?.skipReason, 'INTERRUPTED', '結果頁看得到原因');
    assert.ok(result.status !== 'not_claimed' && 'summary' in result && result.summary);
    assert.equal(result.summary!.pending, 0, '結束時沒有停在發送中的人');
    assert.equal(result.summary!.failed.INTERRUPTED, 1);
  });
});

describe('排程的附券廣播到時間由排程發送', () => {
  it('建立時選了排程時間，時間到後排程發出券', async () => {
    // PR #364 第五份審查第 16 項：bot 懷疑排程到期後仍呼叫 executeBroadcast（附券廣播會被拒絕）而永遠不發。
    // 走一遍：建立排程 → 時間到 → 排程掃描 → runCouponBroadcast
    const couponId = await coupon(`${MARK}秋排程`);
    const a = await person('scheduled-a');
    const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const b = await runInTenant(prisma, T, (ctx) =>
      createBroadcast(ctx.tx, T, agentId, {
        name: `${MARK} 排程附券`, channelId: lineChannel, couponId, targetType: 'contacts',
        targetConfig: { contactIds: [a.contactId] }, scheduledAt: at,
      }));
    assert.equal((await owner.broadcast.findFirst({ where: { id: b.id } }))?.status, 'scheduled');
    // 時間到
    await owner.broadcast.update({ where: { id: b.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });

    // 只讓排程看到這一則（同一個測試資料庫裡可能有其他測試留下的排程廣播）
    const scoped = new Proxy(owner, {
      get(target, prop) {
        if (prop !== 'broadcast') return Reflect.get(target, prop);
        return { ...target.broadcast, findMany: (args: { where: Record<string, unknown> }) => target.broadcast.findMany({ ...args, where: { ...args.where, id: b.id } }) };
      },
    }) as PrismaClient;
    let poll: (() => Promise<void>) | null = null;
    setupBroadcastScheduler({ registerSchedule: (s: { run: () => Promise<void> }) => { poll = s.run; } } as never, scoped, testIo as never, { prisma, store, webBaseUrl: WEB });
    assert.ok(poll);
    await poll!();

    const row = await owner.broadcast.findFirst({ where: { id: b.id } });
    assert.equal(row?.status, 'completed');
    assert.equal(sentTo(a.uid).length, 1, '收件人收到帶票券連結的訊息');
    assert.equal((await instancesOf(a, couponId)).length, 1);
  });
});
