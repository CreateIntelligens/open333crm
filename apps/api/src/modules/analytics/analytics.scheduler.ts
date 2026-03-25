import type { PrismaClient } from '@prisma/client';
import { runDailyAggregation } from './analytics.aggregator.js';

const HARDCODED_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

/**
 * Simple scheduler that runs daily aggregation.
 * - On startup: aggregate yesterday's data
 * - Every day at 2:00 AM: aggregate previous day
 */
export function setupAnalyticsScheduler(prisma: PrismaClient) {
  // Run yesterday's aggregation on startup
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  runDailyAggregation(prisma, HARDCODED_TENANT_ID, yesterday)
    .then(() => {
      console.log('[AnalyticsScheduler] Aggregation complete for', yesterday.toISOString().slice(0, 10));
    })
    .catch((err) => {
      console.error('[AnalyticsScheduler] Aggregation failed:', err);
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
      try {
        const yd = new Date();
        yd.setDate(yd.getDate() - 1);
        await runDailyAggregation(prisma, HARDCODED_TENANT_ID, yd);
        console.log('[AnalyticsScheduler] Aggregation complete for', yd.toISOString().slice(0, 10));
      } catch (err) {
        console.error('[AnalyticsScheduler] Aggregation failed:', err);
      }
      scheduleNext();
    }, ms);
  }

  scheduleNext();
  console.log('[AnalyticsScheduler] Scheduled. Next run in', Math.round(msUntilNext2AM() / 60000), 'minutes');
}
