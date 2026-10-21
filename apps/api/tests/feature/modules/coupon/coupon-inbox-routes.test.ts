/**
 * 對話發券的路由層（add-coupon-system A11）：權限、渠道可見性（CM-173）、
 * 預設送出（真實 deliverToChannel）失敗時券不發出、發送鍵查詢。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import couponInboxRoutes from '#src/modules/coupon/coupon-inbox.routes.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-inbox-route-${Date.now().toString(36)}`;
const creatorId = randomUUID();
const roles: string[] = [];
const apps: FastifyInstance[] = [];

let channelId = '';
let conversationId = '';
let contactId = '';
let couponId = '';

async function agentWith(slug: string, permissions: string[], access?: 'read_only' | 'reply_only') {
  const role = await owner.role.create({
    data: { tenantId: T, slug: `${MARK}-${slug}`, name: `${MARK} ${slug}`, permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) } },
  });
  roles.push(role.id);
  const agent = await owner.agent.create({
    data: { tenantId: T, email: `${MARK}-${slug}@example.com`, name: `座席${slug}`, passwordHash: 'x', roleId: role.id },
  });
  if (access) await owner.agentChannelAccess.create({ data: { channelId, agentId: agent.id, accessLevel: access } });

  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: () => ({ emit: () => {} }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: agent.id, tenantId: T, role: 'AGENT', roleId: role.id } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(couponInboxRoutes, { prefix: '/api/v1/coupon-issue' });
  await app.ready();
  apps.push(app);
  return app;
}

const issueBody = () => ({ couponId, requestKey: randomUUID(), expectedAssigneeId: null });
const held = () => owner.couponInstance.count({ where: { tenantId: T, contactId } });

beforeAll(async () => {
  // 憑證無法解密：真實的 deliverToChannel 送不出，模擬顧客收不到訊息
  channelId = (await owner.channel.create({
    data: { tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted: 'x', isActive: true },
  })).id;
  const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-顧客` } });
  contactId = contact.id;
  await owner.channelIdentity.create({ data: { contactId, channelId, channelType: 'LINE', uid: `${MARK}-uid` } });
  conversationId = (await owner.conversation.create({ data: { tenantId: T, contactId, channelId, channelType: 'LINE' } })).id;
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(tx, T, creatorId, {
      name: `${MARK} 補償券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'RT',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 5,
    }));
  couponId = c.id;
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(tx, T, couponId, 'ACTIVE'))).ok);
});

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.message.deleteMany({ where: { conversationId } });
  await owner.conversation.deleteMany({ where: { id: conversationId } });
  await owner.contact.deleteMany({ where: { id: contactId } });
  await owner.agentChannelAccess.deleteMany({ where: { channelId } });
  await owner.channel.deleteMany({ where: { id: channelId } });
  await owner.agent.deleteMany({ where: { tenantId: T, email: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { id: { in: roles } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('客服可於對話中發券並歸戶（HTTP）', () => {
  it('缺少發券權限', async () => {
    const app = await agentWith('view', ['coupon.view', 'inbox.view', 'inbox.reply'], 'reply_only');
    const res = await app.inject({ method: 'POST', url: `/api/v1/coupon-issue/conversations/${conversationId}`, payload: issueBody() });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(res.json().error.details?.requiredPermission, 'coupon.issue');
    assert.equal(await held(), 0);
  });

  it('看不到該渠道的座席不能發券', async () => {
    const app = await agentWith('hidden', ['coupon.view', 'coupon.issue', 'inbox.view', 'inbox.reply']);
    const ctx = await app.inject({ method: 'GET', url: `/api/v1/coupon-issue/conversations/${conversationId}` });
    assert.equal(ctx.statusCode, 404, ctx.body);
    const res = await app.inject({ method: 'POST', url: `/api/v1/coupon-issue/conversations/${conversationId}`, payload: issueBody() });
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(await held(), 0);
  });

  it('只能看的座席不能發券', async () => {
    const app = await agentWith('readonly', ['coupon.view', 'coupon.issue', 'inbox.view'], 'read_only');
    const res = await app.inject({ method: 'POST', url: `/api/v1/coupon-issue/conversations/${conversationId}`, payload: issueBody() });
    assert.equal(res.statusCode, 403, res.body);
    assert.equal(await held(), 0);
    // 已發優惠券只需要能看
    const issued = await app.inject({ method: 'GET', url: `/api/v1/coupon-issue/conversations/${conversationId}/issued` });
    assert.equal(issued.statusCode, 200, issued.body);
  });

  it('發券訊息送不出時券不發出', async () => {
    const app = await agentWith('reply', ['coupon.view', 'coupon.issue', 'inbox.view', 'inbox.reply'], 'reply_only');
    const ctx = await app.inject({ method: 'GET', url: `/api/v1/coupon-issue/conversations/${conversationId}` });
    assert.equal(ctx.statusCode, 200, ctx.body);
    assert.ok(ctx.json().data.coupons.some((c: { id: string }) => c.id === couponId));

    const body = issueBody();
    const res = await app.inject({ method: 'POST', url: `/api/v1/coupon-issue/conversations/${conversationId}`, payload: body });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'COUPON_DELIVERY_FAILED');
    assert.equal(res.json().error.message, '顧客目前無法接收訊息，券未發出');
    assert.equal(await held(), 0);
    assert.equal(await owner.message.count({ where: { conversationId } }), 0);

    // 查詢發送結果：同一個發送鍵回傳第一次的結果
    const state = await app.inject({ method: 'GET', url: `/api/v1/coupon-issue/requests/${body.requestKey}` });
    assert.equal(state.json().data.state, 'done');
    assert.equal(state.json().data.result.reason, 'COUPON_DELIVERY_FAILED');
  });
});
