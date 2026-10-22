/**
 * 券詳情頁「發送給…」批次發券（add-coupon-system A15 15.21；design D31）：
 * 建立一則附券廣播（發放方式 batch），以附券廣播的引擎發送。只需要 coupon.issue。
 *
 * 路由以 app_tenant 連線執行（RLS 生效）；建立與清理資料用 owner 連線。
 * 渠道外掛換成記錄用的替身，票券連結用記憶體儲存。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerChannelPlugin, type ChannelPlugin, type OutboundPayload } from '@open333crm/channel-plugins';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { encryptCredentials } from '#src/modules/channel/channel.service.js';
import couponRoutes from '#src/modules/coupon/coupon.routes.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { getCouponBroadcastSummary } from '#src/modules/marketing/broadcast-coupon.service.js';
import { runCouponBroadcast } from '#src/modules/marketing/broadcast-coupon.flow.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { ctxOf, runInTenant, testIo } from '#tests/support/tenant-run.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `bc-batch-${Date.now().toString(36)}`;
const creatorId = randomUUID();

const sent: Array<{ to: string; payload: OutboundPayload }> = [];
registerChannelPlugin({
  channelType: 'LINE',
  maxMessagesPerSend: 5,
  verifySignature: () => true,
  parseWebhook: async () => [],
  getProfile: async (uid: string) => ({ uid, displayName: uid }),
  sendMessage: async (to: string, payload: OutboundPayload) => {
    sent.push({ to, payload });
    return { success: true };
  },
} as unknown as ChannelPlugin);

const store = memBindingStore();
let app: FastifyInstance;
let lineChannel = '';
let agent = { id: '', name: '座席阿哲' };
/** 目前請求使用的角色；切換以測試權限 */
let currentRoleId = '';
const roles = { issuer: '', viewer: '' };
let couponId = '';

async function person(name: string, withIdentity = true) {
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-${name}` } });
  if (withIdentity) {
    await owner.channelIdentity.create({
      data: { contactId: contact.id, channelId: lineChannel, channelType: 'LINE', uid: `${MARK}-${name}`, profileName: name },
    });
  }
  return { contactId: contact.id, uid: `${MARK}-${name}` };
}

const post = (payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/v1/coupons/${couponId}/batch-issue`, payload: payload as never });
const broadcastCount = () => owner.broadcast.count({ where: { tenantId: T, couponId } });

beforeAll(async () => {
  lineChannel = (await owner.channel.create({
    data: {
      tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, isActive: true,
      credentialsEncrypted: encryptCredentials({ channelAccessToken: 'x' }),
    },
  })).id;
  agent = { id: (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: agent.name, passwordHash: 'x' } })).id, name: agent.name };
  // 座席只看得到被授權的渠道：批次發券要能回覆這個渠道
  await owner.agentChannelAccess.create({ data: { channelId: lineChannel, agentId: agent.id, accessLevel: 'reply_only' } });
  const mkRole = async (slug: string, codes: string[]) =>
    (await owner.role.create({
      data: { tenantId: T, slug: `${MARK}-${slug}`, name: `${MARK}-${slug}`, permissions: { create: codes.map((permissionCode) => ({ permissionCode })) } },
    })).id;
  roles.issuer = await mkRole('issuer', ['coupon.view', 'coupon.issue']);
  roles.viewer = await mkRole('viewer', ['coupon.view']);

  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: '秋季九折', couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'BT',
      redeemMode: 'SELF', perContactLimit: 1,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  couponId = c.id;

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', testIo);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: T, role: 'AGENT', roleId: currentRoleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(couponRoutes, { prefix: '/api/v1/coupons' });
  await app.ready();
});

beforeEach(() => {
  sent.length = 0;
  currentRoleId = roles.issuer;
});

afterAll(async () => {
  await app.close();
  const broadcasts = await owner.broadcast.findMany({ where: { tenantId: T, couponId }, select: { id: true } });
  await owner.broadcastRecipient.deleteMany({ where: { broadcastId: { in: broadcasts.map((b) => b.id) } } });
  await owner.broadcast.deleteMany({ where: { tenantId: T, couponId } });
  await owner.couponInstance.deleteMany({ where: { tenantId: T, couponId } });
  await owner.coupon.deleteMany({ where: { id: couponId } });
  const contacts = await owner.contact.findMany({ where: { tenantId: T, displayName: { startsWith: MARK } }, select: { id: true } });
  await owner.channelIdentity.deleteMany({ where: { contactId: { in: contacts.map((c) => c.id) } } });
  await owner.contact.deleteMany({ where: { id: { in: contacts.map((c) => c.id) } } });
  await owner.role.deleteMany({ where: { id: { in: [roles.issuer, roles.viewer] } } });
  await owner.agentChannelAccess.deleteMany({ where: { agentId: agent.id } });
  await owner.agent.deleteMany({ where: { id: agent.id } });
  await owner.channel.deleteMany({ where: { id: lineChannel } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('從券詳情頁批次發券', () => {
  it('勾選聯絡人發券', async () => {
    const people = [await person('pick-a'), await person('pick-b'), await person('pick-c')];
    const before = await broadcastCount();
    const res = await post({ channelId: lineChannel, targetType: 'contacts', contactIds: people.map((p) => p.contactId) });
    assert.equal(res.statusCode, 202, res.body);
    const broadcastId = res.json().data.broadcastId as string;
    assert.equal(await broadcastCount(), before + 1, '廣播列表多一則附券廣播');

    await runCouponBroadcast({ prisma, io: testIo, store, webBaseUrl: 'https://crm.example.com' }, T, broadcastId);
    for (const p of people) {
      assert.equal(sent.filter((s) => s.to === p.uid).length, 1, '各收到一則帶自己票券連結的訊息');
      const [instance] = await owner.couponInstance.findMany({ where: { tenantId: T, couponId, contactId: p.contactId } });
      assert.equal(instance?.issuedVia, 'batch', '發放方式為「批次發放」');
      assert.equal(instance?.issuedByName, '座席阿哲', '發放者為這位座席');
      assert.match(instance?.issuedSourceName ?? '', /^批次發放 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }
  });

  it('對象沒有這個渠道的身分', async () => {
    const withId = await person('noid-a');
    const without = await person('noid-b', false);
    const res = await post({ channelId: lineChannel, targetType: 'contacts', contactIds: [withId.contactId, without.contactId] });
    assert.equal(res.statusCode, 202, res.body);
    const broadcastId = res.json().data.broadcastId as string;
    await runCouponBroadcast({ prisma, io: testIo, store, webBaseUrl: 'https://crm.example.com' }, T, broadcastId);
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId, contactId: without.contactId } }), 0);
    const summary = await runInTenant(prisma, T, (ctx) => getCouponBroadcastSummary(ctx, broadcastId));
    assert.deepEqual(summary.skipped, { NO_CHANNEL_IDENTITY: 1 }, '結果顯示因沒有渠道身分跳過 1 人');
    assert.equal(summary.issued, 1);
  });

  it('超過人數上限', async () => {
    const before = await broadcastCount();
    const contactIds = Array.from({ length: 1001 }, () => randomUUID());
    const res = await post({ channelId: lineChannel, targetType: 'contacts', contactIds });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(await broadcastCount(), before, '不建立廣播');
  });

  it('看不到的渠道', async () => {
    const other = await owner.channel.create({
      data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-other`, isActive: true, credentialsEncrypted: 'x' },
    });
    try {
      const a = await person('hidden-a');
      const before = await broadcastCount();
      const res = await post({ channelId: other.id, targetType: 'contacts', contactIds: [a.contactId] });
      assert.equal(res.statusCode, 404, res.body);
      assert.equal(await broadcastCount(), before, '不建立廣播');
    } finally {
      await owner.channel.delete({ where: { id: other.id } });
    }
  });

  it('缺少發券權限', async () => {
    currentRoleId = roles.viewer;
    const a = await person('perm-a');
    const before = await broadcastCount();
    const res = await post({ channelId: lineChannel, targetType: 'contacts', contactIds: [a.contactId] });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details?.requiredPermission, 'coupon.issue');
    assert.equal(await broadcastCount(), before);
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId, contactId: a.contactId } }), 0, '沒有發出任何券');
  });
});
