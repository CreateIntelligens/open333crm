/**
 * 已發優惠券區塊即時更新（add-coupon-system design D23；spec coupon-management「已發優惠券區塊即時更新」）。
 * 走真實路由，以替身記下 socket 推送；票券權杖存真實 Redis（顧客端路由用 getBindingStore）。
 * 資料以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { getBindingStore } from '#src/modules/identity-binding/binding-code.js';
import couponRoutes from '#src/modules/coupon/coupon.routes.js';
import couponFanRoutes from '#src/modules/coupon/coupon-fan.routes.js';
import storeConsoleRoutes from '#src/modules/store/store-console.routes.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueInConversation, type InboxFlowDeps } from '#src/modules/coupon/coupon-inbox.flow.js';
import { createStore, createStoreAccount } from '#src/modules/store/store.service.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { ctxOf, recordingIo, type PushRecord } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-rt-${Date.now().toString(36)}`;
const creatorId = randomUUID();
let agentId = '';
let roleId = '';
let channelId = '';
let scanCoupon = '';
let selfCoupon = '';
let storeId = '';
const username = `rt-${Date.now().toString(36)}`;

const emitted: PushRecord[] = [];
const updates = () =>
  emitted.filter((e) => e.event === 'coupon.instance.updated') as Array<PushRecord & { data: Record<string, unknown> }>;
const io = recordingIo(emitted);

let app: FastifyInstance;

const inboxDeps = (): InboxFlowDeps => ({
  prisma,
  io,
  store: getBindingStore(),
  webBaseUrl: 'https://crm.example.com',
  deliver: async () => ({ sent: true }),
});

async function verifiedPerson(name: string) {
  const contact = await owner.contact.create({
    data: { tenantId: T, displayName: `${MARK}-${name}`, identityVerifiedAt: new Date(), identityVerifiedVia: 'email' },
  });
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId, channelType: 'LINE', uid: `${MARK}-${name}` } });
  const conv = await owner.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId, channelType: 'LINE' } });
  return { contactId: contact.id, conversationId: conv.id };
}

async function issue(p: { conversationId: string }, couponId: string) {
  const r = await issueInConversation(inboxDeps(), {
    tenantId: T, couponId, conversationId: p.conversationId, agentId, agentName: '小林',
    expectedAssigneeId: null, requestKey: randomUUID(),
  });
  assert.ok(r.ok, JSON.stringify(r));
  const msg = await owner.message.findUnique({ where: { id: r.messageId } });
  const token = /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec((msg?.content as { text: string }).text)![1];
  return { instanceId: r.instanceId, code: r.code, token };
}

async function coupon(name: string, redeemMode: 'STAFF_SCAN' | 'SELF') {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} ${name}`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'RT',
      redeemMode, perContactLimit: 20,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  return c.id;
}

beforeAll(async () => {
  agentId = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '小林', passwordHash: 'x' } })).id;
  roleId = (await owner.role.create({
    data: { tenantId: T, slug: MARK, name: MARK, permissions: { create: [{ permissionCode: 'coupon.redeem' }] } },
  })).id;
  channelId = (await owner.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: MARK, credentialsEncrypted: 'x', isActive: true },
  })).id;
  scanCoupon = await coupon('掃碼券', 'STAFF_SCAN');
  selfCoupon = await coupon('自助券', 'SELF');
  storeId = (await withTenant(prisma, T, (tx) => createStore(ctxOf(tx, T), { name: `${MARK} 門市` }))).id;
  await withTenant(prisma, T, (tx) => createStoreAccount(ctxOf(tx, T), { storeId, username, password: 'rt-pass-2026' }));

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', io as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agentId, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(couponRoutes, { prefix: '/api/v1/coupons' });
  await app.register(couponFanRoutes, { prefix: '/api/v1/fan/coupons' });
  await app.register(storeConsoleRoutes, { prefix: '/api/v1/store-console' });
  await app.ready();
});

beforeEach(() => {
  emitted.length = 0;
});

afterAll(async () => {
  await app.close();
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.message.deleteMany({ where: { conversation: { tenantId: T, contact: contacts } } });
  await owner.conversation.deleteMany({ where: { tenantId: T, contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.storeAccount.deleteMany({ where: { storeId } });
  await owner.store.deleteMany({ where: { id: storeId } });
  await owner.channel.deleteMany({ where: { id: channelId } });
  await owner.role.deleteMany({ where: { id: roleId } });
  await owner.agent.deleteMany({ where: { id: agentId } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

const tenantRoom = `tenant:${T}`;

describe('已發優惠券區塊即時更新', () => {
  it('座席發券後推送', async () => {
    const p = await verifiedPerson('發券');
    const { instanceId } = await issue(p, scanCoupon);
    assert.deepEqual(updates().map((e) => ({ room: e.room, ...e.data })), [
      { room: tenantRoom, instanceId, contactId: p.contactId, change: 'issued' },
    ]);
  });

  it('顧客開啟票券後推送', async () => {
    const p = await verifiedPerson('開啟');
    const { instanceId, token } = await issue(p, scanCoupon);
    emitted.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/v1/fan/coupons/session', payload: { token } });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(updates().map((e) => ({ room: e.room, ...e.data })), [
      { room: tenantRoom, instanceId, contactId: p.contactId, change: 'viewed' },
    ]);
  });

  it('券被核銷後推送：後台', async () => {
    const p = await verifiedPerson('後台核銷');
    const { instanceId } = await issue(p, scanCoupon);
    emitted.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/v1/coupons/redeem', payload: { instanceId } });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(updates().map((e) => e.data), [{ instanceId, contactId: p.contactId, change: 'redeemed' }]);
    // 核銷失敗不推送
    emitted.length = 0;
    await app.inject({ method: 'POST', url: '/api/v1/coupons/redeem', payload: { instanceId } });
    assert.equal(updates().length, 0);
  });

  it('券被核銷後推送：顧客自助', async () => {
    const p = await verifiedPerson('自助核銷');
    const { instanceId, token } = await issue(p, selfCoupon);
    const session = await app.inject({ method: 'POST', url: '/api/v1/fan/coupons/session', payload: { token } });
    const fanToken = session.json().data.fanToken as string;
    emitted.length = 0;
    const res = await app.inject({
      method: 'POST', url: `/api/v1/fan/coupons/${instanceId}/redeem`, headers: { authorization: `Bearer ${fanToken}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(updates().map((e) => e.data), [{ instanceId, contactId: p.contactId, change: 'redeemed' }]);
  });

  it('券被核銷後推送：核銷台', async () => {
    const p = await verifiedPerson('門市核銷');
    const { instanceId, code } = await issue(p, scanCoupon);
    const login = await app.inject({ method: 'POST', url: '/api/v1/store-console/login', payload: { username, password: 'rt-pass-2026', remember: false } });
    assert.equal(login.statusCode, 200, login.body);
    const storeToken = login.json().data.token as string;
    emitted.length = 0;
    const res = await app.inject({
      method: 'POST', url: '/api/v1/store-console/redeem', headers: { authorization: `Bearer ${storeToken}` },
      payload: { code, key: randomUUID() },
    });
    assert.equal(res.json().data.ok, true, res.body);
    assert.deepEqual(updates().map((e) => e.data), [{ instanceId, contactId: p.contactId, change: 'redeemed' }]);
  });
});
