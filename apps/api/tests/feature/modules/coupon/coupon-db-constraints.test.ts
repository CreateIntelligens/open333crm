/**
 * 優惠券相關的資料庫約束（#362 A3、A4）。
 *
 * - A3：coupon_claim_links 以複合外鍵 (couponId, tenantId)、(channelId, tenantId) 參照券與渠道，
 *   連結不可指向其他租戶的券或渠道。RLS 只檢查連結本身的 tenantId，擋不住這種寫入。
 * - A4：broadcasts.couponId 有外鍵；刪除草稿券時，指向它的廣播 couponId 清成 NULL，不留下指向不存在的券的廣播。
 */
import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { withTenant } from '#src/lib/tenant-db.js';
import { deleteCoupon } from '#src/modules/coupon/coupon.service.js';
import { runInTenant } from '#tests/support/tenant-run.js';

const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
const tenantDb = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TENANT } } });
const A = process.env.RLS_TEST_TENANT_A ?? 'a0000000-0000-0000-0000-000000000001';
const B = process.env.RLS_TEST_TENANT_B ?? 'b0000000-0000-0000-0000-000000000002';
const MARK = `db-constraints-${Date.now().toString(36)}`;
let seq = 0;
const uniq = () => `${Date.now().toString(36).toUpperCase().slice(-5)}${(seq++).toString(36).toUpperCase().padStart(3, '0')}`;

async function coupon(tenantId: string, status: 'DRAFT' | 'ACTIVE' = 'ACTIVE') {
  return admin.coupon.create({
    data: { tenantId, name: MARK, displayCode: `CP-${uniq()}`, createdById: tenantId, purpose: 'MARKETING', status },
  });
}
async function channel(tenantId: string) {
  return admin.channel.create({ data: { tenantId, channelType: 'LINE', displayName: MARK, credentialsEncrypted: 'x' } });
}
const linkData = (tenantId: string, couponId: string, channelId: string) => ({
  tenantId, couponId, channelId, name: MARK, code: uniq(), createdById: tenantId,
});

const FK_ERROR = /foreign key constraint/i;

describe('領券連結的券與渠道必須同一租戶（#362 A3）', () => {
  let couponA = '';
  let couponB = '';
  let channelA = '';
  let channelB = '';

  beforeAll(async () => {
    couponA = (await coupon(A)).id;
    couponB = (await coupon(B)).id;
    channelA = (await channel(A)).id;
    channelB = (await channel(B)).id;
  });

  it('同租戶的券與渠道：可以建立', async () => {
    const link = await admin.couponClaimLink.create({ data: linkData(A, couponA, channelA) });
    assert.equal(link.tenantId, A);
  });

  it('其他租戶的券：資料庫拒絕（即使用 BYPASSRLS 的連線）', async () => {
    await assert.rejects(() => admin.couponClaimLink.create({ data: linkData(A, couponB, channelA) }), FK_ERROR);
  });

  it('其他租戶的渠道：資料庫拒絕（即使用 BYPASSRLS 的連線）', async () => {
    await assert.rejects(() => admin.couponClaimLink.create({ data: linkData(A, couponA, channelB) }), FK_ERROR);
  });

  it('綁定 A 租戶寫入自己的連結、指向 B 的券：RLS 放行，複合外鍵拒絕', async () => {
    await assert.rejects(
      () => withTenant(tenantDb, A, (tx) => tx.couponClaimLink.create({ data: linkData(A, couponB, channelA) })),
      FK_ERROR,
    );
  });

  it('刪除券時它的領券連結跟著刪除', async () => {
    const draft = await coupon(A, 'DRAFT');
    const link = await admin.couponClaimLink.create({ data: linkData(A, draft.id, channelA) });
    await admin.coupon.delete({ where: { id: draft.id } });
    assert.equal(await admin.couponClaimLink.count({ where: { id: link.id } }), 0);
  });
});

describe('廣播的附券外鍵（#362 A4）', () => {
  let channelA = '';

  beforeAll(async () => {
    channelA = (await channel(A)).id;
  });

  it('不可附上不存在的券', async () => {
    await assert.rejects(
      () => admin.broadcast.create({
        data: { tenantId: A, channelId: channelA, name: MARK, createdById: A, couponId: '00000000-0000-4000-8000-0000000000ff' },
      }),
      FK_ERROR,
    );
  });

  it('刪除草稿券：指向它的廣播 couponId 清成 NULL，廣播本身保留', async () => {
    // 正常流程下廣播只能附上進行中的券；這裡直接寫入，模擬資料異常時刪除流程的結果
    const draft = await coupon(A, 'DRAFT');
    const broadcast = await admin.broadcast.create({
      data: { tenantId: A, channelId: channelA, name: MARK, createdById: A, couponId: draft.id },
    });

    const result = await runInTenant(tenantDb, A, (ctx) => deleteCoupon(ctx, draft.id));

    assert.deepEqual(result, { deleted: true });
    const after = await admin.broadcast.findUnique({ where: { id: broadcast.id } });
    assert.ok(after, '廣播保留');
    assert.equal(after.couponId, null);
  });
});

afterAll(async () => {
  await admin.couponClaimLink.deleteMany({ where: { name: MARK } });
  await admin.broadcast.deleteMany({ where: { name: MARK } });
  await admin.coupon.deleteMany({ where: { name: MARK } });
  await admin.channel.deleteMany({ where: { displayName: MARK } });
  await admin.$disconnect();
  await tenantDb.$disconnect();
});
