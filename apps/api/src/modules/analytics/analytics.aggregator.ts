import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { ALL_CHANNELS } from '../../services/channel-visibility.js';
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
 * 呼叫端以 inTenant() 開這個租戶的交易，五種統計一起成立。
 * 彙總的是全租戶的數字（ALL_CHANNELS），不屬於任何成員的可見範圍。
 */
export async function runDailyAggregation(ctx: TenantCtx, date: Date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  // Overview
  const overview = await getOverviewStats(ctx, ALL_CHANNELS, dayStart, dayEnd);
  await upsertStat(ctx, dayStart, 'overview', null, overview);

  // Case stats
  const caseStats = await getCaseStats(ctx, ALL_CHANNELS, dayStart, dayEnd);
  await upsertStat(ctx, dayStart, 'case', null, caseStats);

  // Agent performance
  const agents = await getAgentPerformance(ctx, ALL_CHANNELS, dayStart, dayEnd);
  for (const agent of agents) {
    await upsertStat(ctx, dayStart, 'agent', agent.agentId, agent);
  }

  // Channel analytics
  const channels = await getChannelAnalytics(ctx, ALL_CHANNELS, dayStart, dayEnd);
  await upsertStat(ctx, dayStart, 'channel', null, channels);

  // Contact analytics
  const contacts = await getContactAnalytics(ctx, ALL_CHANNELS, dayStart, dayEnd);
  await upsertStat(ctx, dayStart, 'contact', null, contacts);
}

async function upsertStat(
  ctx: TenantCtx,
  date: Date,
  statType: string,
  dimensionId: string | null,
  data: Record<string, unknown>,
) {
  await ctx.tx.dailyStat.upsert({
    where: {
      tenantId_date_statType_dimensionId: {
        tenantId: ctx.tenantId,
        date,
        statType,
        dimensionId: dimensionId ?? '',
      },
    },
    create: {
      tenantId: ctx.tenantId,
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
