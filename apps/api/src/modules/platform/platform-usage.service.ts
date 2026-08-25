/**
 * 平台用量統計（跨租戶 + 單租戶）。資料源 AiUsage。
 * costUsd 一律在後端 SUM（Decimal），前端不加總字串只顯示。
 * 只算 success=true 的呼叫（失敗成本為 0，計入次數但不計 token/cost）。
 */
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export interface UsageRange {
  from: Date;
  to: Date;
}

function defaultRange(): UsageRange {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400_000);
  return { from, to };
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

/** 單租戶鑽取：近 N 日每日趨勢 + feature 分佈。 */
export async function getTenantUsageDetail(
  prisma: PrismaClient,
  tenantId: string,
  range?: Partial<UsageRange>,
) {
  const { from, to } = { ...defaultRange(), ...range };
  const where = { tenantId, success: true, createdAt: { gte: from, lte: to } };

  // 每日趨勢：用 $queryRaw 依日期 group（Prisma groupBy 無法 truncate date）
  const trend = await prisma.$queryRaw<
    { day: Date; tokens: bigint; cost: string; calls: bigint }[]
  >`
    SELECT date_trunc('day', "createdAt") AS day,
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
    trend: trend.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      tokens: Number(r.tokens),
      costUsd: r.cost ?? '0',
      calls: Number(r.calls),
    })),
    byFeature: byFeature.map((g) => ({
      feature: g.feature,
      totalTokens: g._sum.totalTokens ?? 0,
      totalCostUsd: (g._sum.costUsd ?? new Prisma.Decimal(0)).toString(),
      calls: g._count,
    })),
  };
}
