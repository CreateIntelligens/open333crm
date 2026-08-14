import type { PrismaClient } from '@prisma/client';
import { runDailyAggregation } from './analytics.aggregator.js';
import { logger } from '@open333crm/core';

/**
 * 對所有啟用中的租戶各跑一次當日聚合。
 * 單一租戶失敗不影響其他租戶（逐一 try/catch）。
 */
async function aggregateAllTenants(prisma: PrismaClient, date: Date) {
  const day = date.toISOString().slice(0, 10);
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  logger.info(`[AnalyticsScheduler] Aggregating ${day} for ${tenants.length} active tenant(s)`);

  for (const { id: tenantId } of tenants) {
    try {
      await runDailyAggregation(prisma, tenantId, date);
    } catch (err) {
      // 單一租戶失敗只記 log，不中斷其他租戶的聚合
      logger.error(`[AnalyticsScheduler] Aggregation failed for tenant ${tenantId} (${day}):`, err);
    }
  }

  logger.info(`[AnalyticsScheduler] Aggregation complete for ${day}`);
}

/**
 * Simple scheduler that runs daily aggregation.
 * - On startup: aggregate yesterday's data
 * - Every day at 2:00 AM: aggregate previous day
 */
export function setupAnalyticsScheduler(prisma: PrismaClient) {
  // Run yesterday's aggregation on startup（所有啟用租戶）
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  aggregateAllTenants(prisma, yesterday).catch((err) => {
    logger.error('[AnalyticsScheduler] Startup aggregation failed:', err);
  });

  // Calculate ms until next 2:00 AM
  function msUntilNext2AM(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  // Schedule daily
  function scheduleNext() {
    const ms = msUntilNext2AM();
    setTimeout(async () => {
      const yd = new Date();
      yd.setDate(yd.getDate() - 1);
      // 對所有啟用租戶各跑一次（aggregateAllTenants 內已逐租戶 try/catch）
      await aggregateAllTenants(prisma, yd).catch((err) => {
        logger.error('[AnalyticsScheduler] Daily aggregation failed:', err);
      });
      scheduleNext();
    }, ms);
  }

  scheduleNext();
  logger.info('[AnalyticsScheduler] Scheduled. Next run in', Math.round(msUntilNext2AM() / 60000), 'minutes');
}
