/**
 * 公開領券連結（add-coupon-system A15 15.26、15.27；design D30）。
 *
 * 後台路由：建立、限制（只限行銷券、同租戶渠道、coupon.manage）、停用與重新啟用、QR Code。
 * 公開頁資料端點：有效、已停用、不存在的代碼。
 *
 * 路由以 app_tenant 連線執行（RLS 生效）；建立與清理資料用 owner 連線。
 * 本檔建立的券以 createdById 標記，渠道與角色以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient, withTenant } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import couponClaimLinkRoutes from '#src/modules/coupon/coupon-claim-link.routes.js';
import couponClaimPublicRoutes from '#src/modules/coupon/coupon-claim-public.routes.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { TENANT_A, TENANT_B } from '#tests/setup/feature-config.js';
import { ctxOf } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-claimlink-${Date.now().toString(36)}`;
const creatorId = randomUUID();

let app: FastifyInstance;
/** 每個請求以這個角色登入；測試切換成只有 coupon.view 的角色 */
let currentRoleId = '';
let managerRoleId = '';
let viewerRoleId = '';
let lineChannel = '';
let otherTenantChannel = '';
const coupons = { marketing: '', service: '', draft: '' };

async function coupon(name: string, data: Record<string, unknown>, publish = true) {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} ${name}`, couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'CLK',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 1,
      ...data,
    } as never));
  if (publish) assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  return c.id;
}

beforeAll(async () => {
  const mkRole = (slug: string, codes: string[]) =>
    owner.role.create({
      data: { tenantId: T, slug, name: slug, permissions: { create: codes.map((permissionCode) => ({ permissionCode })) } },
    });
  managerRoleId = (await mkRole(`${MARK}-mgr`, ['coupon.view', 'coupon.manage'])).id;
  viewerRoleId = (await mkRole(`${MARK}-view`, ['coupon.view'])).id;
  currentRoleId = managerRoleId;

  lineChannel = (await owner.channel.create({
    data: {
      tenantId: T, channelType: 'LINE', displayName: `${MARK}-LINE`, credentialsEncrypted: 'x', isActive: true,
      settings: { bindingHandleAuto: '@shop123' },
    },
  })).id;
  otherTenantChannel = (await owner.channel.create({
    data: { tenantId: TENANT_B, channelType: 'LINE', displayName: `${MARK}-B-LINE`, credentialsEncrypted: 'x', isActive: true },
  })).id;

  coupons.marketing = await coupon('秋季九折', {});
  coupons.service = await coupon('補償券', { purpose: 'SERVICE' });
  coupons.draft = await coupon('草稿行銷券', {}, false);

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: creatorId, tenantId: T, role: 'ADMIN', roleId: currentRoleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(couponClaimLinkRoutes, { prefix: '/api/v1/coupons' });
  await app.register(couponClaimPublicRoutes, { prefix: '/api/v1/coupon-claim' });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await owner.couponClaimLink.deleteMany({ where: { createdById: creatorId } });
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.channel.deleteMany({ where: { displayName: { startsWith: MARK } } });
  await owner.role.deleteMany({ where: { id: { in: [managerRoleId, viewerRoleId] } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

async function createLink(couponId: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/v1/coupons/${couponId}/claim-links`, payload: body });
}

describe('管理者可建立公開領券連結', () => {
  it('建立領券連結', async () => {
    const res = await createLink(coupons.marketing, { name: '門市海報', channelId: lineChannel });
    assert.equal(res.statusCode, 201, res.body);
    const data = res.json().data;
    assert.match(data.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.ok(String(data.url).endsWith(`/coupon/claim/${data.code}`), data.url);
    assert.match(data.qrCode, /^data:image\/png;base64,/);
    assert.equal(data.status, 'ACTIVE');
    assert.equal(data.name, '門市海報');

    const list = await app.inject({ method: 'GET', url: `/api/v1/coupons/${coupons.marketing}/claim-links` });
    assert.equal(list.statusCode, 200, list.body);
    const row = list.json().data.find((l: { id: string }) => l.id === data.id);
    assert.equal(row.openCount, 0);
    assert.equal(row.claimCount, 0);
    assert.equal(row.channel.id, lineChannel);

    const png = await app.inject({ method: 'GET', url: `/api/v1/coupons/${coupons.marketing}/claim-links/${data.id}/qrcode` });
    assert.equal(png.statusCode, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.deepEqual([...png.rawPayload.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  });

  it('草稿的行銷券也可以建立', async () => {
    const res = await createLink(coupons.draft, { name: '官網橫幅', channelId: lineChannel });
    assert.equal(res.statusCode, 201, res.body);
  });

  it('一張券可以建立多個連結，代碼各不相同', async () => {
    const a = (await createLink(coupons.marketing, { name: '甲', channelId: lineChannel })).json().data;
    const b = (await createLink(coupons.marketing, { name: '乙', channelId: lineChannel })).json().data;
    assert.notEqual(a.code, b.code);
  });

  it('客服補償券不能建立領券連結', async () => {
    const res = await createLink(coupons.service, { name: '門市海報', channelId: lineChannel });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(await owner.couponClaimLink.count({ where: { couponId: coupons.service } }), 0);
  });

  it('其他租戶的渠道', async () => {
    const res = await createLink(coupons.marketing, { name: '跨租戶', channelId: otherTenantChannel });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(await owner.couponClaimLink.count({ where: { channelId: otherTenantChannel } }), 0);
  });

  it('缺少管理權限', async () => {
    currentRoleId = viewerRoleId;
    try {
      const res = await createLink(coupons.marketing, { name: '沒有權限', channelId: lineChannel });
      assert.equal(res.statusCode, 403, res.body);
      assert.equal(res.json().error.details?.requiredPermission, 'coupon.manage', res.body);
      // 只有 coupon.view 仍看得到連結清單
      const list = await app.inject({ method: 'GET', url: `/api/v1/coupons/${coupons.marketing}/claim-links` });
      assert.equal(list.statusCode, 200, list.body);
    } finally {
      currentRoleId = managerRoleId;
    }
  });

  it('停用後可以重新啟用', async () => {
    const link = (await createLink(coupons.marketing, { name: '停用測試', channelId: lineChannel })).json().data;
    const off = await app.inject({ method: 'POST', url: `/api/v1/coupons/${coupons.marketing}/claim-links/${link.id}/disable` });
    assert.equal(off.statusCode, 200, off.body);
    assert.equal(off.json().data.status, 'DISABLED');
    const on = await app.inject({ method: 'POST', url: `/api/v1/coupons/${coupons.marketing}/claim-links/${link.id}/enable` });
    assert.equal(on.json().data.status, 'ACTIVE');
  });

  it('結束時間早於開始時間', async () => {
    const res = await createLink(coupons.marketing, {
      name: '期間錯誤', channelId: lineChannel, startAt: '2026-12-31', endAt: '2026-12-01',
    });
    assert.equal(res.statusCode, 400, res.body);
  });
});

describe('公開領券頁引導顧客傳送領券訊息', () => {
  it('開啟有效的領券頁', async () => {
    const link = (await createLink(coupons.marketing, { name: '門市海報', channelId: lineChannel })).json().data;
    const res = await app.inject({ method: 'GET', url: `/api/v1/coupon-claim/${link.code}` });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json().data;
    assert.equal(data.available, true);
    assert.equal(data.coupon.name, `${MARK} 秋季九折`);
    assert.equal(data.channel.channelType, 'LINE');
    assert.equal(data.channel.addFriendUrl, 'https://line.me/R/ti/p/%40shop123');
    assert.ok(decodeURIComponent(data.channel.sendCodeUrl).includes(link.code), data.channel.sendCodeUrl);
    assert.ok(data.channel.sendCodeUrl.startsWith('https://line.me/R/oaMessage/%40shop123/?'));
    const row = await owner.couponClaimLink.findUnique({ where: { id: link.id } });
    assert.equal(row?.openCount, 1, '開啟數加 1');
  });

  it('代碼大小寫不同也能開啟', async () => {
    const link = (await createLink(coupons.marketing, { name: '小寫', channelId: lineChannel })).json().data;
    const res = await app.inject({ method: 'GET', url: `/api/v1/coupon-claim/${String(link.code).toLowerCase()}` });
    assert.equal(res.statusCode, 200, res.body);
  });

  it('已停用的連結', async () => {
    const link = (await createLink(coupons.marketing, { name: '停用', channelId: lineChannel })).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/coupons/${coupons.marketing}/claim-links/${link.id}/disable` });
    const res = await app.inject({ method: 'GET', url: `/api/v1/coupon-claim/${link.code}` });
    assert.equal(res.statusCode, 200, res.body);
    const data = res.json().data;
    assert.equal(data.available, false);
    assert.equal(data.message, '這個領券活動目前無法領取');
    assert.equal(data.channel, null, '沒有領券按鈕');
  });

  it('還沒開始的連結也不顯示領券按鈕', async () => {
    const link = (await createLink(coupons.marketing, {
      name: '未開始', channelId: lineChannel, startAt: new Date(Date.now() + 86_400_000).toISOString(),
    })).json().data;
    const data = (await app.inject({ method: 'GET', url: `/api/v1/coupon-claim/${link.code}` })).json().data;
    assert.equal(data.available, false);
    assert.equal(data.channel, null);
  });

  it('草稿的券不能領', async () => {
    const link = (await createLink(coupons.draft, { name: '草稿', channelId: lineChannel })).json().data;
    const data = (await app.inject({ method: 'GET', url: `/api/v1/coupon-claim/${link.code}` })).json().data;
    assert.equal(data.available, false);
  });

  it('不存在的代碼', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/coupon-claim/ZZZZ2222' });
    assert.equal(res.statusCode, 404, res.body);
    const body = res.json();
    assert.equal(body.success, false);
    assert.equal(body.data, undefined, '不顯示任何商家資料');
    assert.ok(!res.body.includes(T), '不透露租戶');
  });

  it('格式不對的代碼也回 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/coupon-claim/%3Cscript%3E' });
    assert.equal(res.statusCode, 404, res.body);
  });
});
