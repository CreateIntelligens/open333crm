/**
 * tenant-plan「部署後保留平台修改」以真實 PostgreSQL 與 Prisma 驗證（issue #441，PR #450 審查）。
 *
 * 單元測試的假資料庫不會模擬 Prisma 的 `@updatedAt`；這裡對測試資料庫實跑 seedPlans()，
 * 確認 `upsert({ update: {} })` 不寫入既有方案、`updatedAt` 也不變。feature 組不平行執行檔案，
 * 測試結束時把 light 方案還原。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { seedPlans, SEED_PLANS } from '../../../../../../packages/database/prisma/seed-data/plans.js';

const owner = new PrismaClient();

afterAll(async () => {
  await owner.$disconnect();
});

test('部署後保留平台修改：真實資料庫執行 seedPlans 兩次，light 的內容與 updatedAt 不變', async () => {
  await seedPlans(owner);
  const original = await owner.plan.findUniqueOrThrow({ where: { slug: 'light' } });
  const fixedAt = new Date('2020-01-01T00:00:00Z');
  const edited = {
    name: '平台改過的輕量版',
    limits: { ...(original.limits as Record<string, unknown>), maxAgents: 8 } as Prisma.InputJsonValue,
    priceMonthly: 12345,
  };
  // 原生 SQL 設定 updatedAt：Prisma 的 update 會自動覆寫 @updatedAt
  await owner.plan.update({ where: { slug: 'light' }, data: edited });
  await owner.$executeRaw`UPDATE plans SET "updatedAt" = ${fixedAt} WHERE slug = 'light'`;

  try {
    await seedPlans(owner);
    await seedPlans(owner);
    const after = await owner.plan.findUniqueOrThrow({ where: { slug: 'light' } });
    assert.equal(after.name, edited.name);
    assert.equal((after.limits as { maxAgents?: number }).maxAgents, 8);
    assert.equal(Number(after.priceMonthly), 12345);
    assert.equal(after.updatedAt.toISOString(), fixedAt.toISOString(), 'updatedAt 不可被 seed 更新');
  } finally {
    await owner.plan.update({
      where: { slug: 'light' },
      data: { name: original.name, limits: original.limits as Prisma.InputJsonValue, priceMonthly: original.priceMonthly },
    });
  }
});

test('方案不存在時 seed 建立：五個 seed 方案在真實資料庫都存在', async () => {
  await seedPlans(owner);
  const slugs = (await owner.plan.findMany({ where: { slug: { in: SEED_PLANS.map((p) => p.slug) } }, select: { slug: true } })).map((p) => p.slug);
  assert.deepEqual(slugs.sort(), SEED_PLANS.map((p) => p.slug).sort());
});
