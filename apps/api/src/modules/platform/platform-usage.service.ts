/**
 * 平台用量統計（跨租戶 + 單租戶）。資料源 AiUsage。
 * costUsd 一律在後端 SUM（Decimal），前端不加總字串只顯示。
 * 只算 success=true 的呼叫（失敗成本為 0，計入次數但不計 token/cost）。
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { taipeiDatesBetween, taipeiRecentDays } from '@open333crm/core';

export interface UsageRange {
  from: Date;
  to: Date;
}

/** 預設期間：最近 30 天（含今天），從台灣今天往前 29 天的 00:00 到現在；每日趨勢剛好 30 筆。總覽、排行與鑽取共用 */
function defaultRange(): UsageRange {
  return taipeiRecentDays(30);
}

/** 跨租戶總覽：總 token / 總成本 / 呼叫數 / 各 provider 佔比。 */
export async function getUsageOverview(prisma: PrismaClient, range?: Partial<UsageRange>) {
  const { from, to } = { ...defaultRange(), ...range };
  const where = { success: true, createdAt: { gte: from, lte: to } };

  const [agg, providerGroups, tenantCount] = await Promise.all([
    prisma.aiUsage.aggregate({
      where,
      _sum: { totalTokens: true, costUsd: true },
      _count: true,
    }),
    prisma.aiUsage.groupBy({
      by: ['provider'],
      where,
      _sum: { totalTokens: true, costUsd: true },
      _count: true,
    }),
    // 有用量的租戶數
    prisma.aiUsage.findMany({ where, select: { tenantId: true }, distinct: ['tenantId'] }),
  ]);

  return {
    range: { from, to },
    totalTokens: agg._sum.totalTokens ?? 0,
    totalCostUsd: (agg._sum.costUsd ?? new Prisma.Decimal(0)).toString(),
    totalCalls: agg._count,
    activeTenants: tenantCount.length,
    byProvider: providerGroups.map((g) => ({
      provider: g.provider,
      totalTokens: g._sum.totalTokens ?? 0,
      totalCostUsd: (g._sum.costUsd ?? new Prisma.Decimal(0)).toString(),
      calls: g._count,
    })),
  };
}

/** 各租戶用量排行（依 token 降序），附租戶名與方案。 */
export async function getTenantUsageRanking(prisma: PrismaClient, range?: Partial<UsageRange>) {
  const { from, to } = { ...defaultRange(), ...range };
  const groups = await prisma.aiUsage.groupBy({
    by: ['tenantId'],
    where: { success: true, createdAt: { gte: from, lte: to } },
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
    orderBy: { _sum: { totalTokens: 'desc' } },
    take: 50,
  });

  // 補租戶名/方案（一次查回，避免 N+1）
  const tenantIds = groups.map((g) => g.tenantId);
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true, plan: { select: { slug: true, name: true } } },
  });
  const tMap = new Map(tenants.map((t) => [t.id, t]));

  return groups.map((g) => ({
    tenantId: g.tenantId,
    tenantName: tMap.get(g.tenantId)?.name ?? '(未知租戶)',
    planName: tMap.get(g.tenantId)?.plan?.name ?? null,
    totalTokens: g._sum.totalTokens ?? 0,
    totalCostUsd: (g._sum.costUsd ?? new Prisma.Decimal(0)).toString(),
    calls: g._count,
  }));
}

export interface UsageTrendDay {
  /** 台灣日期 YYYY-MM-DD */
  day: string;
  tokens: number;
  costUsd: string;
  calls: number;
}

/** 補齊期間內每一天的上限；超過時只列有用量的日子，避免回應過大（與券統計相同） */
const MAX_TREND_DAYS = 400;

/**
 * @description 把依台灣日期分組的用量補成期間內每天一筆，沒有用量的日子為 0，圖表才是一天一格。
 * @param rows 依台灣日期分組的用量（只有有用量的日子）
 * @param from 期間起點
 * @param to 期間終點
 * @returns 依日期由舊到新的每日用量；期間超過 MAX_TREND_DAYS 天時只含有用量的日子
 */
function fillTrendDays(
  rows: { day: string; tokens: bigint; cost: string | null; calls: bigint }[],
  from: Date,
  to: Date,
): UsageTrendDay[] {
  const byDay = new Map<string, UsageTrendDay>(
    rows.map((r) => [r.day, { day: r.day, tokens: Number(r.tokens), costUsd: r.cost ?? '0', calls: Number(r.calls) }]),
  );
  const days = taipeiDatesBetween(from, to, MAX_TREND_DAYS);
  if (!days) return [...byDay.values()];
  return days.map((day) => byDay.get(day) ?? { day, tokens: 0, costUsd: '0', calls: 0 });
}

/** 單租戶鑽取：期間內每日趨勢（台灣日期，每天一筆）+ feature 分佈。 */
export async function getTenantUsageDetail(
  prisma: PrismaClient,
  tenantId: string,
  range?: Partial<UsageRange>,
) {
  const { from, to } = { ...defaultRange(), ...range };
  const where = { tenantId, success: true, createdAt: { gte: from, lte: to } };

  // 每日趨勢：用 $queryRaw 依台灣日期 group（Prisma groupBy 無法 truncate date）。
  // "createdAt" 是不帶時區的 timestamp（存 UTC），先標成 UTC 再轉台灣時間，才是台灣日期
  const rows = await prisma.$queryRaw<
    { day: string; tokens: bigint; cost: string | null; calls: bigint }[]
  >`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD') AS day,
           SUM("totalTokens")::bigint AS tokens,
           SUM("costUsd")::text AS cost,
           COUNT(*)::bigint AS calls
    FROM ai_usages
    WHERE "tenantId" = ${tenantId}::uuid AND success = true
      AND "createdAt" >= ${from} AND "createdAt" <= ${to}
    GROUP BY 1 ORDER BY 1 ASC`;

  const byFeature = await prisma.aiUsage.groupBy({
    by: ['feature'],
    where,
    _sum: { totalTokens: true, costUsd: true },
    _count: true,
    orderBy: { _sum: { totalTokens: 'desc' } },
  });

  return {
    range: { from, to },
    trend: fillTrendDays(rows, from, to),
    byFeature: byFeature.map((g) => ({
      feature: g.feature,
      totalTokens: g._sum.totalTokens ?? 0,
      totalCostUsd: (g._sum.costUsd ?? new Prisma.Decimal(0)).toString(),
      calls: g._count,
    })),
  };
}
