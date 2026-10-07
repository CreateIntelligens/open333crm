/**
 * 平台用量查詢（主規格 platform-usage「平台用量查詢」）。
 * 每個測試在交易內建立租戶與用量，結束時 rollback。總覽與排行跨租戶加總，
 * 所以這些測試把用量放在 2001 年，並以這段期間查詢，避開其他資料。
 *
 * 屬於 feature 組：連線設定與測試資料庫由 tests/setup/ 準備。
 */
import assert from 'node:assert/strict';
import { afterAll, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  getTenantUsageDetail,
  getTenantUsageRanking,
  getUsageOverview,
} from '#src/modules/platform/platform-usage.service.js';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const RANGE = { from: new Date('2001-01-01T00:00:00Z'), to: new Date('2001-01-31T23:59:59Z') };

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}
let seq = 0;

interface Fixture {
  tx: PrismaClient;
  tenant: (name: string, planName?: string) => Promise<string>;
  usage: (tenantId: string, data: { totalTokens: number; costUsd?: string; success?: boolean; feature?: string; createdAt: Date }) => Promise<void>;
}

function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    await assert.rejects(
      prisma.$transaction(async (raw) => {
        const tx = raw as unknown as PrismaClient;
        const tag = `usage-${Date.now()}-${seq++}`;
        await fn({
          tx,
          tenant: async (tenantName, planName) => {
            const plan = planName
              ? await tx.plan.create({ data: { slug: `${tag}-${tenantName}`, name: planName } })
              : null;
            return (await tx.tenant.create({ data: { name: tenantName, planId: plan?.id ?? null } })).id;
          },
          usage: async (tenantId, data) => {
            await tx.aiUsage.create({
              data: {
                tenantId,
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                feature: data.feature ?? 'kb-autoreply',
                totalTokens: data.totalTokens,
                costUsd: data.costUsd ?? '0',
                success: data.success ?? true,
                createdAt: data.createdAt,
              },
            });
          },
        });
        throw new Rollback();
      }),
      Rollback,
    );
  });
}

scenario('總覽只計算成功的呼叫：呼叫次數是 2，token 與成本只含成功的呼叫', async ({ tx, tenant, usage }) => {
  const t = await tenant('A');
  await usage(t, { totalTokens: 100, costUsd: '0.5', createdAt: new Date('2001-01-10T00:00:00Z') });
  await usage(t, { totalTokens: 200, costUsd: '0.25', createdAt: new Date('2001-01-11T00:00:00Z') });
  await usage(t, { totalTokens: 999, costUsd: '9', success: false, createdAt: new Date('2001-01-12T00:00:00Z') });

  const overview = await getUsageOverview(tx, RANGE);

  assert.equal(overview.totalCalls, 2);
  assert.equal(overview.totalTokens, 300);
  assert.equal(overview.totalCostUsd, '0.75');
  assert.equal(overview.activeTenants, 1);
  assert.deepEqual(overview.byProvider, [{ provider: 'gemini', totalTokens: 300, totalCostUsd: '0.75', calls: 2 }]);
});

scenario('租戶依 token 用量排列：租戶 B 排在租戶 A 之前，含租戶名稱與方案名稱', async ({ tx, tenant, usage }) => {
  const a = await tenant('租戶 A', '輕量版');
  const b = await tenant('租戶 B', '標準版');
  await usage(a, { totalTokens: 500, createdAt: new Date('2001-01-10T00:00:00Z') });
  await usage(b, { totalTokens: 2000, createdAt: new Date('2001-01-10T00:00:00Z') });

  const ranking = await getTenantUsageRanking(tx, RANGE);

  assert.deepEqual(
    ranking.map((r) => [r.tenantName, r.planName, r.totalTokens]),
    [
      ['租戶 B', '標準版', 2000],
      ['租戶 A', '輕量版', 500],
    ],
  );
});

scenario('單一租戶的每日用量與來源分布：每日用量有兩天，來源含 kb-autoreply 與 summary', async ({ tx, tenant, usage }) => {
  const t = await tenant('A');
  await usage(t, { totalTokens: 100, feature: 'kb-autoreply', createdAt: new Date('2001-01-10T03:00:00Z') });
  await usage(t, { totalTokens: 300, feature: 'summary', createdAt: new Date('2001-01-11T03:00:00Z') });

  const detail = await getTenantUsageDetail(tx, t, RANGE);

  assert.deepEqual(detail.trend.map((d) => [d.day, d.tokens, d.calls]), [
    ['2001-01-10', 100, 1],
    ['2001-01-11', 300, 1],
  ]);
  assert.deepEqual(detail.byFeature.map((f) => [f.feature, f.totalTokens]).sort(), [
    ['kb-autoreply', 100],
    ['summary', 300],
  ]);
});

scenario('預設查詢最近 30 天：只含昨天的呼叫，不含 40 天前的呼叫', async ({ tx, tenant, usage }) => {
  const t = await tenant('A');
  await usage(t, { totalTokens: 400, createdAt: new Date(Date.now() - 40 * DAY) });
  await usage(t, { totalTokens: 100, createdAt: new Date(Date.now() - DAY) });

  const detail = await getTenantUsageDetail(tx, t);

  assert.deepEqual(detail.trend.map((d) => d.tokens), [100]);
  assert.deepEqual(detail.byFeature.map((f) => f.totalTokens), [100]);
});
