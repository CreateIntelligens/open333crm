/**
 * 票券連結確認身分的公開端點（add-coupon-system design D24；spec coupon-redemption
 * 「顧客須完成歸戶驗證才能開啟票券夾」）：POST /fan/coupons/session（deviceTokens）、
 * /session/code、/session/code/verify。
 *
 * 走真實路由；票券權杖與驗證碼存真實 Redis（顧客端路由用 getBindingStore），寄信以注入函式取代。
 * 資料以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import { getBindingStore } from '#src/modules/identity-binding/binding-code.js';
import couponFanRoutes from '#src/modules/coupon/coupon-fan.routes.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueInConversation, type InboxFlowDeps } from '#src/modules/coupon/coupon-inbox.flow.js';
import { signFanDeviceToken, verifyFanDeviceToken, verifyFanToken } from '#src/modules/portal/portal-auth.service.js';
import { invalidateIdentityBindingSettings } from '#src/modules/identity-binding/identity-binding.service.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { ctxOf, testIo } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-devrt-${Date.now().toString(36)}`;
const creatorId = randomUUID();
let agentId = '';
let channelId = '';
let couponId = '';
let originalSettings: unknown = null;
const mails: Array<{ to: string; code: string }> = [];

let app: FastifyInstance;
// 公開端點依 IP 限流（每分鐘 60 次）：每個測試用不同的來源 IP
let ip = 0;
const post = (url: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/v1/fan/coupons${url}`, payload: payload as object, remoteAddress: `10.9.0.${ip}` });

const inboxDeps = (): InboxFlowDeps => ({
  prisma,
  io: testIo,
  store: getBindingStore(),
  webBaseUrl: 'https://crm.example.com',
  deliver: async () => ({ sent: true }),
});

async function verifiedPerson(name: string, email: string | null) {
  const contact = await owner.contact.create({
    data: { tenantId: T, displayName: `${MARK}-${name}`, email, identityVerifiedAt: new Date(), identityVerifiedVia: 'line' },
  });
  await owner.channelIdentity.create({ data: { contactId: contact.id, channelId, channelType: 'FB', uid: `${MARK}-${name}` } });
  const conv = await owner.conversation.create({ data: { tenantId: T, contactId: contact.id, channelId, channelType: 'FB' } });
  return { contactId: contact.id, conversationId: conv.id };
}

async function issue(p: { conversationId: string }) {
  const r = await issueInConversation(inboxDeps(), {
    tenantId: T, couponId, conversationId: p.conversationId, agentId, agentName: '小林',
    expectedAssigneeId: null, requestKey: randomUUID(),
  });
  assert.ok(r.ok, JSON.stringify(r));
  const msg = await owner.message.findUnique({ where: { id: r.messageId } });
  return /\/coupon\/open\/([A-Za-z0-9_-]+)/.exec((msg?.content as { text: string }).text)![1];
}

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

beforeAll(async () => {
  const settings = await owner.tenantSettings.findUnique({ where: { tenantId: T }, select: { identityBinding: true } });
  originalSettings = settings?.identityBinding ?? {};
  await owner.tenantSettings.upsert({
    where: { tenantId: T },
    create: { tenantId: T, identityBinding: { emailEnabled: true } },
    update: { identityBinding: { emailEnabled: true } },
  });
  invalidateIdentityBindingSettings();
  agentId = (await owner.agent.create({ data: { tenantId: T, email: `${MARK}@example.com`, name: '小林', passwordHash: 'x' } })).id;
  channelId = (await owner.channel.create({
    data: { tenantId: T, channelType: 'FB', displayName: MARK, credentialsEncrypted: 'x', isActive: true },
  })).id;
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} 自助券`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, purpose: 'SERVICE',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'DR',
      redeemMode: 'SELF', perContactLimit: 20,
    } as never));
  couponId = c.id;
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), couponId, 'ACTIVE'))).ok);

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('io', testIo as never);
  await app.register(couponFanRoutes, {
    prefix: '/api/v1/fan/coupons',
    sendEmailCode: async (to: string, code: string) => {
      mails.push({ to, code });
    },
  });
  await app.ready();
});

beforeEach(() => {
  ip += 1;
  mails.length = 0;
});

afterAll(async () => {
  await app.close();
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  const contacts = { tenantId: T, displayName: { startsWith: MARK } };
  await owner.message.deleteMany({ where: { conversation: { tenantId: T, contact: contacts } } });
  await owner.conversation.deleteMany({ where: { tenantId: T, contact: contacts } });
  await owner.contact.deleteMany({ where: contacts });
  await owner.channel.deleteMany({ where: { id: channelId } });
  await owner.agent.deleteMany({ where: { id: agentId } });
  await owner.tenantSettings.update({ where: { tenantId: T }, data: { identityBinding: originalSettings as object } });
  invalidateIdentityBindingSettings();
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('POST /session 帶裝置憑證', () => {
  it('已驗證的裝置開啟票券連結', async () => {
    const p = await verifiedPerson('裝置', 'dan@aicreate360.com');
    const token = await issue(p);
    const res = await post('/session', { token, deviceTokens: [signFanDeviceToken(p.contactId, T)] });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json().data;
    assert.equal(data.status, 'ok');
    assert.equal(verifyFanToken(data.fanToken)?.contactId, p.contactId);
    assert.deepEqual(verifyFanDeviceToken(data.deviceToken), { contactId: p.contactId, tenantId: T });
  });

  it('新裝置或轉傳的連結開啟已歸戶顧客的票券', async () => {
    const p = await verifiedPerson('轉傳', 'dan@aicreate360.com');
    const token = await issue(p);
    const res = await post('/session', { token });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json().data, { status: 'email_code_required', maskedEmail: 'd***@aicreate360.com', channelType: 'FB' });
  });

  it('裝置憑證超過 5 筆回 400', async () => {
    const res = await post('/session', { token: 'A'.repeat(43), deviceTokens: Array.from({ length: 6 }, () => 'x') });
    assert.equal(res.statusCode, 400, res.body);
  });
});

describe('POST /session/code 與 /session/code/verify', () => {
  it('寄驗證碼到原 email，輸入正確後回傳顧客憑證與裝置憑證', async () => {
    const p = await verifiedPerson('寄碼', 'amy@example.com');
    const token = await issue(p);
    const sent = await post('/session/code', { token });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(sent.json().data, { status: 'code_sent', maskedEmail: 'a***@example.com' });
    assert.deepEqual(mails.map((m) => m.to), ['amy@example.com']);

    const wrong = await post('/session/code/verify', { token, code: wrongCode(mails[0].code) });
    assert.equal(wrong.statusCode, 400, wrong.body);
    assert.equal(wrong.json().error.code, 'INVALID_VERIFICATION_CODE');
    assert.equal(wrong.json().error.details.remainingAttempts, 4);

    const ok = await post('/session/code/verify', { token, code: mails[0].code });
    assert.equal(ok.statusCode, 200, ok.body);
    const data = ok.json().data;
    assert.equal(data.status, 'ok');
    assert.equal(data.contactId, p.contactId);
    assert.equal(data.tenantId, T);
    assert.equal(data.channelType, 'FB');
    assert.ok(data.instanceId);
    assert.equal(verifyFanToken(data.fanToken)?.contactId, p.contactId);
    assert.deepEqual(verifyFanDeviceToken(data.deviceToken), { contactId: p.contactId, tenantId: T });

    // 顧客憑證可以用來自助核銷
    const redeem = await app.inject({
      method: 'POST', url: `/api/v1/fan/coupons/${data.instanceId}/redeem`, headers: { authorization: `Bearer ${data.fanToken}` },
    });
    assert.equal(redeem.statusCode, 200, redeem.body);
  });

  it('錯 5 次後驗證碼作廢', async () => {
    const p = await verifiedPerson('錯五次', 'lock@example.com');
    const token = await issue(p);
    await post('/session/code', { token });
    for (let i = 0; i < 5; i++) assert.equal((await post('/session/code/verify', { token, code: wrongCode(mails[0].code) })).statusCode, 400);
    const res = await post('/session/code/verify', { token, code: mails[0].code });
    assert.equal(res.statusCode, 429, res.body);
    assert.equal(res.json().error.code, 'VERIFICATION_CODE_LOCKED');
  });

  it('沒有寄過驗證碼就輸入', async () => {
    const p = await verifiedPerson('沒寄過', 'none@example.com');
    const token = await issue(p);
    const res = await post('/session/code/verify', { token, code: '123456' });
    assert.equal(res.statusCode, 410, res.body);
    assert.equal(res.json().error.code, 'VERIFICATION_CODE_EXPIRED');
  });

  it('寄送太多次', async () => {
    const p = await verifiedPerson('寄太多', 'many@example.com');
    const token = await issue(p);
    for (let i = 0; i < 3; i++) assert.equal((await post('/session/code', { token })).statusCode, 200);
    const res = await post('/session/code', { token });
    assert.equal(res.statusCode, 429, res.body);
    assert.equal(res.json().error.code, 'TOO_MANY_VERIFICATION_EMAILS');
  });

  it('沒有 email 的已歸戶顧客不能要求寄驗證碼', async () => {
    const p = await verifiedPerson('沒email', null);
    const token = await issue(p);
    const res = await post('/session/code', { token });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'EMAIL_CODE_UNAVAILABLE');
    assert.equal(mails.length, 0);
  });

  it('票券連結不存在或過期一律 410，不透露資料', async () => {
    for (const [url, payload] of [
      ['/session/code', { token: 'A'.repeat(43) }],
      ['/session/code/verify', { token: 'A'.repeat(43), code: '123456' }],
    ] as const) {
      const res = await post(url, payload);
      assert.equal(res.statusCode, 410, `${url} ${res.body}`);
      assert.equal(res.json().error.code, 'LINK_EXPIRED');
      assert.ok(!res.body.includes('@'), res.body);
    }
    assert.equal(mails.length, 0);
  });
});
