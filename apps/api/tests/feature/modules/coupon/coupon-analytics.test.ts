/**
 * 數據報表的優惠券成效（add-coupon-system 12.16；spec coupon-management「數據報表呈現優惠券成效」）。
 * 資料放在 2020 年的區間，不與其他測試重疊；以 createdById 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { getCouponAnalytics, getCouponStats } from '#src/modules/coupon/coupon-stats.service.js';
import Fastify, { type FastifyRequest } from 'fastify';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import analyticsRoutes from '#src/modules/analytics/analytics.routes.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-analytics-${Date.now().toString(36)}`;
const creatorId = randomUUID();
const FROM = new Date('2020-02-29T16:00:00.000Z'); // 台灣 3/1 00:00
const TO = new Date('2020-03-31T15:59:59.999Z'); // 台灣 3/31 23:59
let couponA = '';
let couponB = '';

async function mkCoupon(name: string) {
  return (await owner.coupon.create({
    data: {
      tenantId: T, name: `${MARK} ${name}`, displayCode: `CP-${randomUUID().slice(0, 8)}`, createdById: creatorId, status: 'ACTIVE',
      purpose: 'SERVICE', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, validityMode: 'AFTER_CLAIM', afterClaimDays: 30,
      codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_SCAN', perContactLimit: 99,
    },
  })).id;
}

let n = 0;
async function mkInstance(couponId: string, issuedAt: string, status: 'ISSUED' | 'CLAIMED' | 'REDEEMED', extra: Record<string, unknown> = {}) {
  n += 1;
  return owner.couponInstance.create({
    data: {
      tenantId: T, couponId, code: `${MARK.slice(-6).toUpperCase()}${n}`, status, issuedAt: new Date(issuedAt),
      claimedAt: status === 'ISSUED' ? null : new Date(issuedAt),
      redeemedAt: status === 'REDEEMED' ? new Date(new Date(issuedAt).getTime() + 3600_000) : null,
      ...extra,
    },
  });
}

beforeAll(async () => {
  couponA = await mkCoupon('券A');
  couponB = await mkCoupon('券B');
  const opened = { linkOpenedAt: new Date('2020-03-05T05:00:00.000Z'), linkOpenCount: 2 };
  await mkInstance(couponA, '2020-03-05T02:00:00.000Z', 'REDEEMED', opened);
  await mkInstance(couponA, '2020-03-05T03:00:00.000Z', 'REDEEMED', opened);
  await mkInstance(couponA, '2020-03-06T03:00:00.000Z', 'CLAIMED', opened);
  await mkInstance(couponA, '2020-03-06T04:00:00.000Z', 'ISSUED');
  await mkInstance(couponA, '2020-02-20T04:00:00.000Z', 'REDEEMED'); // 期間開始前
  await mkInstance(couponB, '2020-03-01T16:30:00.000Z', 'CLAIMED'); // 台灣 3/2 00:30
  await mkInstance(couponB, '2020-03-07T04:00:00.000Z', 'ISSUED');
  await mkInstance(couponB, '2020-03-08T04:00:00.000Z', 'CLAIMED', { deliveryPendingAt: new Date('2020-03-08T04:00:00.000Z') }); // 發送中
});

afterAll(async () => {
  await owner.role.deleteMany({ where: { tenantId: T, slug: { startsWith: MARK } } });
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('數據報表呈現優惠券成效', () => {
  it('期間內的優惠券成效', async () => {
    const r = await getCouponAnalytics(tenantScopedClient(prisma, T), T, FROM, TO);
    assert.deepEqual({ ...r.totals, linkOpened: undefined }, { issued: 6, claimed: 4, redeemed: 2, redeemRate: 50, linkOpened: undefined });
    const mine = r.topCoupons.filter((c) => c.couponId === couponA || c.couponId === couponB);
    assert.equal(mine[0].couponId, couponA);
    assert.deepEqual(
      { issued: mine[0].issued, claimed: mine[0].claimed, redeemed: mine[0].redeemed, redeemRate: mine[0].redeemRate },
      { issued: 4, claimed: 3, redeemed: 2, redeemRate: 66.7 },
    );
    assert.equal(mine[0].name, `${MARK} 券A`);
  });

  it('每日趨勢以台灣日期分日', async () => {
    const r = await getCouponAnalytics(tenantScopedClient(prisma, T), T, FROM, TO);
    const day = (d: string) => r.trend.find((t) => t.date === d);
    assert.equal(day('2020-03-02')?.issued, 1);
    assert.equal(r.trend.length, 31, '3/1 到 3/31 每一天都有資料');
    assert.deepEqual(day('2020-03-01'), { date: '2020-03-01', issued: 0, redeemed: 0 });
    assert.equal(day('2020-03-05')?.issued, 2);
    assert.equal(day('2020-03-05')?.redeemed, 2);
  });

  it('發送中的券不計入', async () => {
    const r = await getCouponAnalytics(tenantScopedClient(prisma, T), T, FROM, TO);
    assert.equal(r.trend.find((t) => t.date === '2020-03-08')?.issued ?? 0, 0);
  });
});

describe('記錄票券連結的開啟', () => {
  it('成效顯示開啟連結張數', async () => {
    const stats = await getCouponStats(tenantScopedClient(prisma, T), T, couponA);
    assert.equal(stats?.linkOpened, 3);
  });

  it('數據報表顯示開啟連結張數', async () => {
    const r = await getCouponAnalytics(tenantScopedClient(prisma, T), T, FROM, TO);
    assert.equal(r.totals.linkOpened, 3);
    assert.equal(r.topCoupons.find((c) => c.couponId === couponA)?.linkOpened, 3);
  });
});

describe('報表 API', () => {
  async function appWith(permissions: string[]) {
    const role = await owner.role.create({
      data: { tenantId: T, slug: `${MARK}-${permissions.join('-') || 'none'}`, name: MARK, permissions: { create: permissions.map((permissionCode) => ({ permissionCode })) } },
    });
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.decorate('prisma', prisma);
    app.decorate('prismaAdmin', owner);
    app.decorate('authenticate', async (request: FastifyRequest) => {
      request.agent = { id: creatorId, tenantId: T, role: 'AGENT', roleId: role.id } as never;
      (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
    });
    await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
    await app.ready();
    return app;
  }
  const url = `/api/v1/analytics/coupons?from=${FROM.toISOString()}&to=${TO.toISOString()}`;

  it('有報表權限可以查看優惠券成效', async () => {
    const app = await appWith(['analytics.view']);
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().data.totals.issued, 6);
    await app.close();
  });

  it('只能看自己數據的座席不能查看', async () => {
    const app = await appWith(['analytics.view.self']);
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 403, res.body);
    await app.close();
  });
});

