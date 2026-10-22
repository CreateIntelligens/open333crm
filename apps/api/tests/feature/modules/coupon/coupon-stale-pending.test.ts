/**
 * 自動化發券卡在發送中（add-coupon-system A15 15.4、design D25；spec coupon-management
 * 「自動化發券先保留、送出成功才確認」的「自動化發券卡在發送中」）。
 *
 * workers 保留券後、送出途中結束時，券停在發送中。API 的 coupon-stale-pending-issue 排程
 * 不分發放方式，作廢超過 5 分鐘的發送中券，名額與序號歸還。
 * 建立與清理資料用 owner 連線；本檔建立的券以 createdById 標記，聯絡人以 MARK 標記，於 afterAll 刪除。
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { loadEnvConfig } from '#src/config/env.js';
import { withTenant } from '#src/lib/tenant-db.js';
import { TENANT_A } from '#tests/setup/feature-config.js';
import { createCoupon } from '#src/modules/coupon/coupon.service.js';
import { changeStatus } from '#src/modules/coupon/coupon-lifecycle.service.js';
import { sweepStalePendingIssues } from '#src/modules/coupon/coupon.scheduler.js';
import { ctxOf, testIo } from '#tests/support/tenant-run.js';

loadEnvConfig();
const owner = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const T = TENANT_A;
const MARK = `coupon-stale-${Date.now()}`;
const creatorId = randomUUID();
const ruleId = randomUUID();
let couponId = '';
let contactId = '';

beforeAll(async () => {
  const c = await withTenant(prisma, T, (tx) =>
    createCoupon(ctxOf(tx, T), creatorId, {
      name: `${MARK} 秋季九折`, couponType: 'DISCOUNT_PERCENT', discountPercent: 10, purpose: 'MARKETING',
      validityMode: 'AFTER_CLAIM', afterClaimDays: 30, codeMode: 'IMPORTED_CODES',
      redeemMode: 'STAFF_CODE', staffCode: '582917', perContactLimit: 1, totalLimit: 10,
    } as never));
  couponId = c.id;
  await owner.couponCode.create({ data: { tenantId: T, couponId, code: `${MARK.slice(-6)}POOL1`, status: 'AVAILABLE' } });
  assert.ok((await withTenant(prisma, T, (tx) => changeStatus(ctxOf(tx, T), couponId, 'ACTIVE'))).ok);
  contactId = (await owner.contact.create({ data: { tenantId: T, displayName: `${MARK}-顧客` } })).id;
});

afterAll(async () => {
  await owner.coupon.deleteMany({ where: { tenantId: T, createdById: creatorId } });
  await owner.contact.deleteMany({ where: { tenantId: T, displayName: { startsWith: MARK } } });
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe('自動化發券先保留、送出成功才確認', () => {
  it('自動化發券卡在發送中：排程作廢這張券，名額與序號歸還', async () => {
    // workers 保留時的樣子：序號包配出一組序號、券在發送中、發放方式 keyword、issuedRefId 為規則 id
    const code = await owner.couponCode.findFirstOrThrow({ where: { tenantId: T, couponId, status: 'AVAILABLE' } });
    const stuck = await owner.couponInstance.create({
      data: {
        tenantId: T, couponId, contactId, code: code.code, status: 'CLAIMED', claimedAt: new Date(),
        issuedVia: 'keyword', issuedRefId: ruleId, issuedSourceName: '秋季領券',
        deliveryPendingAt: new Date(Date.now() - 6 * 60 * 1000),
      },
    });
    await owner.couponCode.update({ where: { id: code.id }, data: { status: 'ASSIGNED', instanceId: stuck.id } });

    await sweepStalePendingIssues({ admin: owner, prisma }, Date.now(), testIo);

    assert.equal(await owner.couponInstance.count({ where: { id: stuck.id } }), 0, '卡在發送中超過 5 分鐘的自動化發券要作廢');
    assert.equal(await owner.couponInstance.count({ where: { tenantId: T, couponId } }), 0, '已發放張數歸還');
    const after = await owner.couponCode.findUniqueOrThrow({ where: { id: code.id } });
    assert.equal(after.status, 'AVAILABLE', '序號放回可配發');
    assert.equal(after.instanceId, null);
  });
});
