/**
 * 方案種子的內容（issue #411，change enable-channels-on-trial-light-411）。
 * 渠道（LINE、FB、IG、WebChat）是每個方案的基本功能：channel.* 權限碼屬於 channels feature，
 * 方案不含 channels 時，租戶管理員看不到也建不了任何渠道。
 * seed 不在 src/ 裡，所以這裡用相對路徑匯入。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { SEED_PLANS, seedPlans } from '../../../prisma/seed-data/plans.js';

const plan = (slug: string) => {
  const found = SEED_PLANS.find((p) => p.slug === slug);
  assert.ok(found, `seed 應有 ${slug} 方案`);
  return found;
};

test('試用與輕量版方案可以使用渠道：trial、light 的 features 含 channels', () => {
  assert.ok(plan('trial').features.includes('channels'), `trial features：${plan('trial').features.join(',')}`);
  assert.ok(plan('light').features.includes('channels'), `light features：${plan('light').features.join(',')}`);
});

test('每個 seed 方案都含 channels', () => {
  for (const p of SEED_PLANS) assert.ok(p.features.includes('channels'), `${p.slug} 缺 channels`);
});

test('seed 方案的渠道數上限不是 0：能看到渠道頁就能建立渠道', () => {
  for (const p of SEED_PLANS) {
    const max = p.limits.maxChannels;
    assert.ok(max === undefined || max === null || max > 0, `${p.slug} 的 maxChannels 是 ${max}`);
  }
});

// ── 部署時保留平台後台的修改（issue #441，AUDIT PLAN-20）──
// API 容器每次啟動都跑 seed。平台在 /admin/plans 改過的方案內容，seed 不可以改回原始碼的值。
// 假的 plan model 用記憶體模擬資料庫，upsert 照 Prisma 的語意實作（已存在套用 update，否則用 create），
// 測試只看最後資料庫裡的內容。

type PlanRow = Record<string, unknown> & { slug: string };

function fakePlanDb(initial: PlanRow[]) {
  const rows = new Map<string, PlanRow>(initial.map((r) => [r.slug, structuredClone(r)]));
  const plan = {
    upsert: async (args: { where: { slug: string }; update: Record<string, unknown>; create: PlanRow }) => {
      const existing = rows.get(args.where.slug);
      if (existing) Object.assign(existing, args.update);
      else rows.set(args.create.slug, structuredClone(args.create));
    },
  };
  return { prisma: { plan } as never, rows };
}

const editedLight: PlanRow = {
  slug: 'light',
  name: '輕量版（平台改名）',
  features: ['inbox', 'channels', 'core', 'marketing'],
  limits: { maxAgents: 8, maxTags: 100, monthlyTokens: 1_500_000 },
  priceMonthly: 2000,
  allowedChannelTypes: ['LINE'],
  permissionOverrides: { deny: ['marketing.broadcast'] },
  isActive: false,
};

test('部署後保留平台修改：方案已存在且內容與 seed 不同時，執行 seed 後內容不變', async () => {
  const { prisma, rows } = fakePlanDb([editedLight]);
  await seedPlans(prisma);
  assert.deepEqual(rows.get('light'), editedLight);
});

test('部署後保留平台修改：seed 重複執行兩次，既有方案仍不變', async () => {
  const { prisma, rows } = fakePlanDb([editedLight]);
  await seedPlans(prisma);
  await seedPlans(prisma);
  assert.deepEqual(rows.get('light'), editedLight);
});

test('方案不存在時 seed 建立：空資料庫執行後有五個 seed 方案，內容等於 seed 定義', async () => {
  const { prisma, rows } = fakePlanDb([]);
  await seedPlans(prisma);
  assert.deepEqual([...rows.keys()].sort(), SEED_PLANS.map((p) => p.slug).sort());
  for (const p of SEED_PLANS) {
    const row = rows.get(p.slug);
    assert.ok(row, `缺 ${p.slug}`);
    assert.equal(row.name, p.name);
    assert.deepEqual(row.features, p.features);
    assert.deepEqual(row.limits, p.limits);
    assert.equal(row.priceMonthly, p.priceMonthly);
  }
});

test('只補缺少的方案：已有 light 時建立其他四個方案，light 不變', async () => {
  const { prisma, rows } = fakePlanDb([editedLight]);
  await seedPlans(prisma);
  assert.equal(rows.size, SEED_PLANS.length);
  assert.deepEqual(rows.get('light'), editedLight);
  assert.equal(rows.get('trial')?.name, '免費試用');
});
