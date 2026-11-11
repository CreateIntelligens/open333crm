/**
 * 大量序號明細改背景匯出（add-coupon-system design D22；spec coupon-management「大量序號明細改背景匯出」）。
 * 走真實路由；直接下載的上限以路由選項調成 3 筆，檔案存記憶體版儲存，時間可快轉。
 * 資料以 MARK 標記，afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { tenantScopedClient } from '#src/lib/tenant-db.js';
import errorHandlerPlugin from '#src/plugins/error-handler.plugin.js';
import couponInstanceRoutes from '#src/modules/coupon/coupon-instance.routes.js';
import { memBindingStore } from '#tests/support/mem-binding-store.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { agentPushRoom } from '#src/events/socket-push.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-export-${Date.now().toString(36)}`;
const creatorId = randomUUID();
const clock = { now: Date.now() };
const store = memBindingStore(clock);
let failNext = false;
let roleId = '';
let agentA = '';
let agentB = '';
let currentAgent = '';
let small = '';
let large = '';
const emitted: Array<{ room: string; event: string }> = [];
let app: FastifyInstance;

async function mkCoupon(name: string, count: number) {
  const id = (await owner.coupon.create({
    data: {
      tenantId: T, name: `${MARK} ${name}`, displayCode: `CP-${randomUUID().slice(0, 8)}`, createdById: creatorId, status: 'ACTIVE',
      purpose: 'SERVICE', couponType: 'DISCOUNT_AMOUNT', discountAmount: 100, validityMode: 'AFTER_CLAIM', afterClaimDays: 30,
      codeMode: 'UNIQUE_CODE', redeemMode: 'STAFF_SCAN', perContactLimit: 99,
    },
  })).id;
  await owner.couponInstance.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      tenantId: T, couponId: id, code: `${MARK.slice(-6).toUpperCase()}${name}${i}`, status: 'CLAIMED' as const, claimedAt: new Date(),
    })),
  });
  return id;
}

beforeAll(async () => {
  roleId = (await owner.role.create({
    data: { tenantId: T, slug: MARK, name: MARK, permissions: { create: [{ permissionCode: 'coupon.view' }] } },
  })).id;
  const mkAgent = async (n: string) =>
    (await owner.agent.create({ data: { tenantId: T, email: `${MARK}-${n}@example.com`, name: n, passwordHash: 'x' } })).id;
  agentA = await mkAgent('a');
  agentB = await mkAgent('b');
  small = await mkCoupon('S', 3);
  large = await mkCoupon('L', 4);

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.decorate('prisma', prisma);
  app.decorate('prismaAdmin', owner);
  app.decorate('io', { to: (room: string) => ({ emit: (event: string) => emitted.push({ room, event }) }) } as never);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.agent = { id: currentAgent, tenantId: T, role: 'AGENT', roleId } as never;
    (request as unknown as { tenantPrisma: unknown }).tenantPrisma = tenantScopedClient(prisma, T);
  });
  await app.register(couponInstanceRoutes, {
    prefix: '/api/v1/coupons',
    exportSyncLimit: 3,
    exportStore: store,
    beforeBackgroundExport: async () => {
      if (failNext) {
        failNext = false;
        throw new Error('資料庫連線中斷');
      }
    },
  });
  await app.ready();
});

beforeEach(async () => {
  currentAgent = agentA;
  emitted.length = 0;
  await owner.notification.deleteMany({ where: { agentId: agentA } });
});

afterAll(async () => {
  await app.close();
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.notification.deleteMany({ where: { agentId: { in: [agentA, agentB] } } });
  await owner.agent.deleteMany({ where: { id: { in: [agentA, agentB] } } });
  await owner.role.deleteMany({ where: { id: roleId } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

const exportUrl = (id: string) => `/api/v1/coupons/${id}/instances/export`;
const downloadUrl = (jobId: string) => `/api/v1/coupons/export-jobs/${jobId}/download`;

/** 等這次匯出的通知：每個測試開始前清掉匯出者的通知 */
async function waitForNotification(type: string) {
  for (let i = 0; i < 50; i++) {
    const n = await owner.notification.findFirst({ where: { agentId: agentA, type }, orderBy: { createdAt: 'desc' } });
    if (n) return n;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`等不到 ${type} 通知`);
}

describe('大量序號明細改背景匯出', () => {
  it('明細不多時直接下載', async () => {
    const res = await app.inject({ method: 'GET', url: exportUrl(small) });
    assert.equal(res.statusCode, 200, res.body);
    assert.match(String(res.headers['content-type']), /text\/csv/);
    assert.equal(res.body.trim().split('\n').length, 4, '標題列加 3 筆');
  });

  it('明細超過上限改背景產生', async () => {
    const res = await app.inject({ method: 'GET', url: exportUrl(large) });
    assert.equal(res.statusCode, 202, res.body);
    const { jobId } = res.json().data as { jobId: string };
    const n = await waitForNotification('coupon_export_ready');
    assert.equal(n.title, '序號明細已可下載');
    assert.equal(n.clickUrl, `/dashboard/marketing/coupons/${large}?export=${jobId}`);
    // 通知在 commit 後經 ctx.notifyAgent 推到座席房間（main #337 的推播規則）
    assert.ok(emitted.some((e) => e.room === agentPushRoom(T, agentA) && e.event === 'notification.new'), '即時推送通知');
    const file = await app.inject({ method: 'GET', url: downloadUrl(jobId) });
    assert.equal(file.statusCode, 200, file.body);
    assert.match(String(file.headers['content-disposition']), /filename\*=UTF-8''/);
    assert.equal(file.body.trim().split('\n').length, 5, '標題列加 4 筆');
  });

  it('只有匯出者本人能下載', async () => {
    const res = await app.inject({ method: 'GET', url: exportUrl(large) });
    const { jobId } = res.json().data as { jobId: string };
    await waitForNotification('coupon_export_ready');
    currentAgent = agentB;
    assert.equal((await app.inject({ method: 'GET', url: downloadUrl(jobId) })).statusCode, 404);
  });

  it('背景產生失敗', async () => {
    failNext = true;
    const res = await app.inject({ method: 'GET', url: exportUrl(large) });
    assert.equal(res.statusCode, 202);
    const n = await waitForNotification('coupon_export_failed');
    assert.equal(n.title, '序號明細匯出失敗');
    assert.match(n.body, /重新匯出/);
  });

  it('檔案過期', async () => {
    const res = await app.inject({ method: 'GET', url: exportUrl(large) });
    const { jobId } = res.json().data as { jobId: string };
    await waitForNotification('coupon_export_ready');
    clock.now += 25 * 60 * 60 * 1000;
    try {
      const file = await app.inject({ method: 'GET', url: downloadUrl(jobId) });
      assert.equal(file.statusCode, 410, file.body);
      assert.match(file.json().error.message, /過期/);
    } finally {
      clock.now -= 25 * 60 * 60 * 1000;
    }
  });
});
