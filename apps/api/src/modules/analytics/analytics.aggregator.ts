import type { PrismaClient } from '@prisma/client';
import {
  getOverviewStats,
  getCaseStats,
  getAgentPerformance,
  getChannelAnalytics,
  getContactAnalytics,
} from './analytics.service.js';

/**
 * Run daily aggregation for a given tenant + date.
 * Upserts into DailyStat table (idempotent via @@unique constraint).
 */
export async function runDailyAggregation(
  prisma: PrismaClient,
  tenantId: string,
  date: Date,
) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  // Overview
  const overview = await getOverviewStats(prisma, tenantId, dayStart, dayEnd);
  await upsertStat(prisma, tenantId, dayStart, 'overview', null, overview);

  // Case stats
  const caseStats = await getCaseStats(prisma, tenantId, dayStart, dayEnd);
  await upsertStat(prisma, tenantId, dayStart, 'case', null, caseStats);

  // Agent performance
  const agents = await getAgentPerformance(prisma, tenantId, dayStart, dayEnd);
  for (const agent of agents) {
    await upsertStat(prisma, tenantId, dayStart, 'agent', agent.agentId, agent);
  }

  // Channel analytics
  const channels = await getChannelAnalytics(prisma, tenantId, dayStart, dayEnd);
  await upsertStat(prisma, tenantId, dayStart, 'channel', null, channels);

  // Contact analytics
  const contacts = await getContactAnalytics(prisma, tenantId, dayStart, dayEnd);
  await upsertStat(prisma, tenantId, dayStart, 'contact', null, contacts);
}

async function upsertStat(
  prisma: PrismaClient,
  tenantId: string,
  date: Date,
  statType: string,
  dimensionId: string | null,
  data: Record<string, unknown>,
) {
  await prisma.dailyStat.upsert({
    where: {
      tenantId_date_statType_dimensionId: {
        tenantId,
        date,
        statType,
        dimensionId: dimensionId ?? '',
      },
    },
    create: {
      tenantId,
      date,
      statType,
      dimensionId: dimensionId ?? '',
      data: data as any,
    },
    update: {
      data: data as any,
    },
  });
}
