import type { PrismaClient } from '@prisma/client';
import { runDailyAggregation } from './analytics.aggregator.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { inTenant } from '../../lib/tenant-ctx.js';

interface AnalyticsSchedulerClients {
  /** BYPASSRLS：跨租戶找出啟用中的租戶 */
  admin: PrismaClient;
  /** 為每個租戶開租戶交易 */
  prisma: PrismaClient;
}

/**
 * 對所有啟用中的租戶各跑一次當日聚合，每個租戶一個交易。
 * 單一租戶失敗不影響其他租戶（逐一 try/catch）。逐一處理，耗時隨租戶數增加，做法等 #318 決定。
 */
async function aggregateAllTenants({ admin, prisma }: AnalyticsSchedulerClients, date: Date) {
  const day = date.toISOString().slice(0, 10);
  const tenants = await admin.tenant.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  logger.info(`[AnalyticsScheduler] Aggregating ${day} for ${tenants.length} active tenant(s)`);

  for (const { id: tenantId } of tenants) {
    try {
      await inTenant(prisma, tenantId, (scope) => runDailyAggregation(scope, date));
    } catch (err) {
      // 單一租戶失敗只記 log，不中斷其他租戶的聚合
      logger.error(`[AnalyticsScheduler] Aggregation failed for tenant ${tenantId} (${day}):`, err);
    }
  }

  logger.info(`[AnalyticsScheduler] Aggregation complete for ${day}`);
}

/**
 * 每天 02:00（API 程序的時區）彙總所有啟用中租戶的前一天。
 * 02:00 那一期遇到 API 停機時，job 留在 Redis，API 啟動後補跑一次。
 */
export function setupAnalyticsScheduler(scheduler: JobScheduler, clients: AnalyticsSchedulerClients) {
  scheduler.registerSchedule({
    id: 'analytics-daily',
    pattern: '0 2 * * *',
    run: () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return aggregateAllTenants(clients, yesterday);
    },
  });
}
