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
import couponInstanceRoutes from '#src/modules/coupon/coupon-instance.routes.js';
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
  await app.register(couponInstanceRoutes, { prefix: '/api/v1/coupons' });
  await app.register(memberBindingRoutes, { prefix: '/api/v1/member-binding' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await owner.coupon.deleteMany({ where: { OR: [{ id: couponId }, { tenantId: T, createdById: SOME_ID }] } });
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

describe('後台逐欄驗證找到的問題（2026-10-21）', () => {
  async function draft(name = `${MARK} 草稿`) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/coupons', payload: { name } });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().data.id as string;
  }

  it('券號前綴超過 8 碼或含符號回 400 與說明', async () => {
    const id = await draft();
    for (const codePrefix of ['ABCDEFGHI', 'ABCDEFGHIJKL', 'AB-1', 'AB 1']) {
      const body = await expect400('PATCH', `/api/v1/coupons/${id}`, { codePrefix });
      assert.match(body.error.details.issues[0].message, /前綴/, codePrefix);
    }
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/coupons/${id}`, payload: { codePrefix: 'autumn26' } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().data.codePrefix, 'AUTUMN26');
  });

  it('數字超過可存的範圍回 400', async () => {
    const id = await draft();
    for (const field of ['discountAmount', 'minSpend', 'percentCap', 'giftQty', 'exchangeValueCap', 'afterClaimDays', 'afterOpenMinutes', 'totalLimit', 'perContactLimit', 'claimTagTtlDays']) {
      await expect400('PATCH', `/api/v1/coupons/${id}`, { [field]: 2147483648 });
    }
    const ok = await app.inject({ method: 'PATCH', url: `/api/v1/coupons/${id}`, payload: { discountAmount: 9_999_999 } });
    assert.equal(ok.statusCode, 200, ok.body);
  });

  it('中文券名可以匯出 CSV，檔名保留中文', async () => {
    const id = await draft(`${MARK} 秋季回饋`);
    const res = await app.inject({ method: 'GET', url: `/api/v1/coupons/${id}/instances/export` });
    assert.equal(res.statusCode, 200, res.body);
    const disposition = String(res.headers['content-disposition']);
    assert.match(disposition, /filename\*=UTF-8''/);
    assert.ok(decodeURIComponent(disposition.split("UTF-8''")[1]).includes('秋季回饋'));
  });

  it('複製 30 字名稱的券，新名稱不超過 30 字且可再儲存', async () => {
    const name = `複${'一'.repeat(29)}`;
    const id = await draft(name);
    const dup = await app.inject({ method: 'POST', url: `/api/v1/coupons/${id}/duplicate` });
    assert.equal(dup.statusCode, 200, dup.body);
    const copied = dup.json().data;
    assert.ok([...copied.name].length <= 30, copied.name);
    assert.ok(copied.name.endsWith('（複製）'));
    const save = await app.inject({ method: 'PATCH', url: `/api/v1/coupons/${copied.id}`, payload: { name: copied.name } });
    assert.equal(save.statusCode, 200, save.body);
  });

  it('序號包預覽：這張券自己已匯入的序號不算衝突', async () => {
    const id = await draft();
    await app.inject({ method: 'PATCH', url: `/api/v1/coupons/${id}`, payload: { codeMode: 'IMPORTED_CODES' } });
    const code = `OWN${Date.now().toString(36).toUpperCase()}`;
    const imported = await app.inject({ method: 'POST', url: `/api/v1/coupons/${id}/codes`, payload: { codes: code } });
    assert.equal(imported.statusCode, 200, imported.body);
    const preview = await app.inject({ method: 'POST', url: `/api/v1/coupons/${id}/codes/preview`, payload: { codes: code } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(preview.json().data.conflicts, []);
    assert.deepEqual(preview.json().data.alreadyImported, [code]);
  });
});

describe('券的日期一律以台灣時間計算（design D17）', () => {
  it('固定效期的起訖以台灣時間計算', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/coupons', payload: { name: `${MARK} 台灣時間` } });
    const id = created.json().data.id as string;
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/coupons/${id}`,
      payload: { validityMode: 'FIXED', startAt: '2026-11-01', endAt: '2026-11-30' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.startAt, '2026-10-31T16:00:00.000Z');
    assert.equal(res.json().data.endAt, '2026-11-30T15:59:59.999Z');
  });

  it('領取後 N 天到期以台灣日期計算', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/coupons', payload: { name: `${MARK} 領取後到期` } });
    const id = created.json().data.id as string;
    await app.inject({
      method: 'PATCH', url: `/api/v1/coupons/${id}`,
      payload: {
        purpose: 'SERVICE', couponType: 'DISCOUNT_AMOUNT', discountAmount: 50, validityMode: 'AFTER_CLAIM', afterClaimDays: 3,
        codeMode: 'UNIQUE_CODE', codePrefix: 'TPE', redeemMode: 'STAFF_SCAN', perContactLimit: 1,
      },
    });
    const published = await app.inject({ method: 'POST', url: `/api/v1/coupons/${id}/publish` });
    assert.equal(published.statusCode, 200, published.body);
    const contact = await owner.contact.create({ data: { tenantId: T, displayName: `${MARK} 領取者` } });
    try {
      const before = new Date();
      const issued = await app.inject({ method: 'POST', url: `/api/v1/coupons/${id}/issue`, payload: { contactIds: [contact.id] } });
      assert.equal(issued.statusCode, 200, issued.body);
      const instance = await owner.couponInstance.findFirst({ where: { couponId: id, contactId: contact.id } });
      const taipeiToday = new Date(before.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
      const expected = new Date(Date.parse(`${taipeiToday}T23:59:59.999+08:00`) + 3 * 86_400_000).toISOString();
      assert.equal(instance?.expiresAt?.toISOString(), expected);
    } finally {
      await owner.couponInstance.deleteMany({ where: { contactId: contact.id } });
      await owner.contact.delete({ where: { id: contact.id } });
    }
  });
});

