/**
 * 優惠券排程：作廢卡在發送中的對話發券（add-coupon-system design D16）。
 */
import type { PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { sweepStalePendingIssues } from './coupon-inbox.service.js';

export function setupCouponScheduler(scheduler: JobScheduler, prisma: PrismaClient) {
  scheduler.registerSchedule({
    id: 'coupon-stale-pending-issue',
    every: 60_000,
    withoutOverlapping: { expiresInMs: 5 * 60_000 },
    run: async () => {
      const swept = await sweepStalePendingIssues(prisma, Date.now());
      if (swept > 0) logger.warn(`[CouponScheduler] 作廢 ${swept} 張卡在發送中的券`);
    },
  });
}
