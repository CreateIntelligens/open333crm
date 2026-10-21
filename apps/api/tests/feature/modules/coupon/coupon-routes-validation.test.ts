/**
 * 優惠券與會員綁定路由的輸入驗證（code review 2026-10-21）：格式不對的輸入回 400 與可讀的訊息，
 * 不讓資料庫丟錯變成 500，也不讓任意字串寫進成效歸因或設定。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import couponRoutes from '#src/modules/coupon/coupon.routes.js';
import memberBindingRoutes from '#src/modules/member-binding/member-binding.routes.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-validate-${Date.now().toString(36)}`;
const SOME_ID = '00000000-0000-4000-8000-0000000000aa';
let app: FastifyInstance;
let roleId = '';
let couponId = '';

beforeAll(async () => {
  const role = await owner.role.create({
    data: {
      tenantId: T, slug: MARK, name: MARK,
      permissions: {
        create: ['coupon.view', 'coupon.manage', 'coupon.issue', 'coupon.redeem', 'settings.manage', 'contact.view', 'contact.update']
          .map((permissionCode) => ({ permissionCode })),
      },
    },
  });
  roleId = role.id;
  // 真的存在的券：確認擋下的是輸入格式，而不是查無此券
  couponId = (await owner.coupon.create({
    data: { tenantId: T, name: `${MARK} 券`, displayCode: `CP-${MARK.slice(-6).toUpperCase()}`, createdById: SOME_ID, perContactLimit: 1, maskCodeBeforeStart: true,
      // 發布中、可發放：確認擋下的是輸入格式，而不是草稿不能發
      status: 'ACTIVE', purpose: 'SERVICE', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100,
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'IMPORTED_CODES', redeemMode: 'STAFF_SCAN' },
  })).id;
  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: SOME_ID, tenantId: T, role: 'ADMIN', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(couponRoutes, { prefix: '/api/v1/coupons' });
  await app.register(memberBindingRoutes, { prefix: '/api/v1/member-binding' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await owner.coupon.deleteMany({ where: { id: couponId } });
  await owner.role.deleteMany({ where: { id: roleId } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

async function expect400(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as never });
  assert.equal(res.statusCode, 400, `${method} ${url} → ${res.statusCode} ${res.body}`);
  // 由路由的格式驗證擋下，不是資料庫丟錯（DATABASE_ERROR）或查無資料
  assert.equal(res.json().error.code, 'VALIDATION_ERROR', res.body);
  assert.notEqual(res.json().error.message, '查無此券', res.body);
  return res.json();
}

describe('券 id 格式不對', () => {
  for (const [method, path] of [
    ['GET', ''], ['PATCH', ''], ['DELETE', ''], ['POST', '/publish'], ['POST', '/duplicate'], ['POST', '/issue'],
    ['POST', '/codes'], ['DELETE', '/codes/ABCD1234'],
  ] as const) {
    it(`${method} /coupons/:id${path}`, async () => {
      await expect400(method, `/api/v1/coupons/not-a-uuid${path}`, method === 'GET' || method === 'DELETE' ? undefined : {});
    });
  }
});

describe('發券', () => {
  it('對象不是 uuid', async () => {
    await expect400('POST', `/api/v1/coupons/${couponId}/issue`, { contactIds: ['abc'] });
  });
  it('對象不是陣列', async () => {
    await expect400('POST', `/api/v1/coupons/${couponId}/issue`, { contactIds: 'abc' });
  });
  it('發放方式不是代號格式', async () => {
    await expect400('POST', `/api/v1/coupons/${couponId}/issue`, { contactIds: [SOME_ID], issuedVia: '<script>' });
  });
});

describe('序號匯入', () => {
  it('codes 不是字串', async () => {
    await expect400('POST', `/api/v1/coupons/${couponId}/codes`, { codes: 123 });
    await expect400('POST', `/api/v1/coupons/${couponId}/codes/preview`, { codes: ['A'] });
  });
});

describe('後台核銷', () => {
  it('沒有券號也沒有券 id', async () => {
    const body = await expect400('POST', '/api/v1/coupons/redeem', {});
    assert.equal(body.error.message, '請提供券號');
  });
  it('券 id 不是 uuid', async () => {
    await expect400('POST', '/api/v1/coupons/redeem', { instanceId: 'abc' });
  });
});

describe('會員綁定設定', () => {
  it('結構不對', async () => {
    await expect400('PUT', '/api/v1/member-binding', { enabled: 'yes', endpoint: 1 });
  });
  it('查詢方式不是 GET 或 POST', async () => {
    await expect400('PUT', '/api/v1/member-binding', {
      enabled: false, endpoint: 'https://crm.example.com/members/{{memberId}}', method: 'DELETE',
      auth: { type: 'none' }, fieldMapping: { memberId: 'id' },
    });
  });
  it('代客綁定的聯絡人 id 不是 uuid', async () => {
    await expect400('POST', '/api/v1/member-binding/contacts/abc', { memberId: '123' });
  });
  it('代客綁定的輸入不是文字', async () => {
    await expect400('POST', `/api/v1/member-binding/contacts/${SOME_ID}`, { memberId: { $ne: null } });
  });
});
