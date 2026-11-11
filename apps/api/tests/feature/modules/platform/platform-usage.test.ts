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

  assert.deepEqual(detail.trend.filter((d) => d.calls > 0).map((d) => [d.day, d.tokens, d.calls]), [
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

  assert.deepEqual(detail.trend.filter((d) => d.calls > 0).map((d) => d.tokens), [100]);
  assert.deepEqual(detail.byFeature.map((f) => f.totalTokens), [100]);
});

/** 台灣日期（UTC+8） */
const taipeiDate = (at: Date) => new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

scenario('預設期間對齊台灣日期：每日用量剛好 30 筆，從台灣 29 天前到今天，三個查詢共用', async ({ tx, tenant, usage }) => {
  const now = new Date();
  const first = taipeiDate(new Date(now.getTime() - 29 * DAY));
  // 台灣 29 天前的 00:00
  const fromStart = new Date(Date.parse(`${first}T00:00:00.000Z`) - 8 * 3600_000);
  const t = await tenant('A');
  await usage(t, { totalTokens: 400, createdAt: new Date(fromStart.getTime() - 60_000) }); // 期間開始前 1 分鐘
  await usage(t, { totalTokens: 100, createdAt: new Date(fromStart.getTime() + 60_000) }); // 期間開始後 1 分鐘

  const detail = await getTenantUsageDetail(tx, t);
  const ranking = await getTenantUsageRanking(tx);

  assert.equal(detail.trend.length, 30);
  assert.equal(detail.trend[0].day, first);
  assert.equal(detail.trend[29].day, taipeiDate(now));
  assert.equal(detail.trend[0].tokens, 100);
  assert.equal(ranking.find((r) => r.tenantId === t)?.totalTokens, 100);
  assert.equal(detail.range.from.toISOString(), fromStart.toISOString());
});

// 台灣時間 2001-01-01 00:00 到 2001-01-05 23:59:59.999（UTC+8，沒有日光節約時間）
const TAIPEI_5_DAYS = { from: new Date('2000-12-31T16:00:00.000Z'), to: new Date('2001-01-05T15:59:59.999Z') };

scenario('每日用量補齊沒有用量的日子：依序 5 天，沒有用量的日子是 0', async ({ tx, tenant, usage }) => {
  const t = await tenant('A');
  await usage(t, { totalTokens: 100, costUsd: '0.5', createdAt: new Date('2001-01-02T04:00:00Z') });
  await usage(t, { totalTokens: 300, costUsd: '0.25', createdAt: new Date('2001-01-04T04:00:00Z') });

  const detail = await getTenantUsageDetail(tx, t, TAIPEI_5_DAYS);

  assert.deepEqual(
    detail.trend.map((d) => [d.day, d.tokens, Number(d.costUsd), d.calls]),
    [
      ['2001-01-01', 0, 0, 0],
      ['2001-01-02', 100, 0.5, 1],
      ['2001-01-03', 0, 0, 0],
      ['2001-01-04', 300, 0.25, 1],
      ['2001-01-05', 0, 0, 0],
    ],
  );
  // 沒有用量的日子固定回字串 "0"，與有用量的日子同型別
  assert.deepEqual(detail.trend[0], { day: '2001-01-01', tokens: 0, costUsd: '0', calls: 0 });
});

scenario('台灣凌晨的呼叫算在台灣當天：UTC 01-09 20:00 算在 2001-01-10', async ({ tx, tenant, usage }) => {
  const t = await tenant('A');
  await usage(t, { totalTokens: 100, createdAt: new Date('2001-01-09T20:00:00Z') }); // 台灣 01-10 04:00
  await usage(t, { totalTokens: 7, createdAt: new Date('2001-01-10T15:59:00Z') }); // 台灣 01-10 23:59

  const detail = await getTenantUsageDetail(tx, t, RANGE);
  const byDay = new Map(detail.trend.map((d) => [d.day, d.tokens]));

  assert.equal(byDay.get('2001-01-10'), 107);
  assert.equal(byDay.get('2001-01-09'), 0);
  // 每日用量的加總等於同一期間排行中的用量
  const ranking = await getTenantUsageRanking(tx, RANGE);
  assert.equal(
    detail.trend.reduce((n, d) => n + d.tokens, 0),
    ranking.find((r) => r.tenantId === t)?.totalTokens,
  );
});

scenario('期間超過 400 天只列有用量的日子：只有兩天', async ({ tx, tenant, usage }) => {
  const t = await tenant('A');
  await usage(t, { totalTokens: 100, createdAt: new Date('2001-01-10T04:00:00Z') });
  await usage(t, { totalTokens: 200, createdAt: new Date('2002-03-10T04:00:00Z') });

  const detail = await getTenantUsageDetail(tx, t, { from: new Date('2001-01-01T00:00:00Z'), to: new Date('2002-12-31T00:00:00Z') });

  assert.deepEqual(detail.trend.map((d) => [d.day, d.tokens]), [
    ['2001-01-10', 100],
    ['2002-03-10', 200],
  ]);
});
