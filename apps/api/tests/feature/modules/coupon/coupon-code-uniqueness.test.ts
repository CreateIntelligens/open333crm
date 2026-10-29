/**
 * 一人一碼的券大量發放時券碼不重複（add-coupon-system C3.2，#375）。
 * 券碼由 allocateCode 隨機產生並查重，資料庫另有 (tenantId, code) 唯一約束；
 * 這裡以真實 PostgreSQL 驗證一次發給大量顧客、以及兩批同時發同一張券時，每張券都拿到不同的券碼。
 *
 * 發券以 app_tenant 連線執行（RLS 生效）；建立與清理資料用 owner 連線。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { issueCoupons } from '#src/modules/coupon/coupon-issue.service.js';
import { ctxOf } from '#tests/support/tenant-run.js';
import { TENANT_A } from '#tests/setup/feature-config.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `code-uniq-${Date.now().toString(36)}`;
const creatorId = randomUUID();
/** 一批發 500 張，交易內每位要查上限、產碼、建券，預設 5 秒不夠 */
const TX = { timeout: 120_000, maxWait: 30_000 };
let couponId = '';

async function contacts(label: string, n: number): Promise<string[]> {
  const rows = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), tenantId: T, displayName: `${MARK}-${label}-${i}` }));
  await owner.contact.createMany({ data: rows });
  return rows.map((r) => r.id);
}

function issue(contactIds: string[]) {
  return withTenant(prisma, T, (tx) => issueCoupons(ctxOf(tx, T), couponId, { contactIds, issuedVia: 'api' }), TX);
}

async function allCodes(): Promise<string[]> {
  const rows = await owner.couponInstance.findMany({ where: { tenantId: T, couponId }, select: { code: true } });
  return rows.map((r) => r.code);
}

beforeAll(async () => {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} 一人一碼`, couponType: 'DISCOUNT_AMOUNT', discountAmount: 50, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'UNIQUE_CODE', codePrefix: 'UQ',
      redeemMode: 'SELF', perContactLimit: 1,
    } as never));
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), c.id, 'ACTIVE'))).ok);
  couponId = c.id;
});

afterAll(async () => {
  // beforeAll 建券失敗時 couponId 還是空字串，拿空字串查 uuid 欄位會拋錯，連帶聯絡人清不掉
  if (couponId) {
    await owner.couponInstance.deleteMany({ where: { tenantId: T, couponId } });
    await owner.coupon.deleteMany({ where: { id: couponId } });
  }
  await owner.contact.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('一人一碼大量發券券碼不重複', () => {
  it('一次發給 500 位顧客：每位都拿到券，券碼都不同', async () => {
    const ids = await contacts('bulk', 500);
    const out = await issue(ids);
    assert.equal(out.issued.length, 500, `應全部發出，略過：${JSON.stringify(out.skipped.slice(0, 3))}`);
    assert.deepEqual(out.skipped, []);
    const codes = out.issued.map((i) => i.code);
    assert.equal(new Set(codes).size, 500, '同一批的券碼不可重複');
    assert.ok(codes.every((code) => code.startsWith('UQ-')), '券碼帶券的前綴');
  }, 180_000);

  it('兩批同時發同一張券：兩批都發完，所有券碼都不同', async () => {
    const [a, b] = await Promise.all([contacts('para-a', 200), contacts('para-b', 200)]);
    const [outA, outB] = await Promise.all([issue(a), issue(b)]);
    assert.equal(outA.issued.length, 200);
    assert.equal(outB.issued.length, 200);
    const codes = await allCodes();
    // 含上一個測試的 500 張：這張券的所有券碼都不重複
    assert.equal(codes.length, 900);
    assert.equal(new Set(codes).size, codes.length, '並行發券的券碼不可重複');
  }, 180_000);
});
