import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { executeBroadcast } from './marketing.service.js';
import { runCouponBroadcast, type CouponBroadcastDeps } from './broadcast-coupon.flow.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Polls for scheduled broadcasts whose scheduledAt <= now and executes them.
 *
 * 附券廣播（couponId 有值）改由 runCouponBroadcast 以 app_tenant 的連線逐步發送（design D29），
 * 需要 couponDeps 的 app_tenant 基底連線與票券連結儲存（Redis）；「立即發送」也是排到這裡執行。
 */
export function setupBroadcastScheduler(
  scheduler: JobScheduler,
  prisma: PrismaClient,
  io: SocketIOServer,
  couponDeps: Omit<CouponBroadcastDeps, 'io'>,
) {
  async function pollScheduled() {
    try {
      const due = await prisma.broadcast.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      });

      for (const broadcast of due) {
        try {
          if (broadcast.couponId) {
            const result = await runCouponBroadcast({ ...couponDeps, io }, broadcast.tenantId, broadcast.id);
            logger.info(`[BroadcastScheduler] 附券廣播 ${broadcast.id}（${broadcast.name}）：${result.status}`);
            continue;
          }
          await executeBroadcast(prisma, io, broadcast.id);
          logger.info(`[BroadcastScheduler] Executed broadcast ${broadcast.id} (${broadcast.name})`);
        } catch (err) {
          // 失敗原因已寫進廣播（failureReason），後台看得到
          logger.error(`[BroadcastScheduler] Failed broadcast ${broadcast.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[BroadcastScheduler] Poll error:', err);
    }
  }

  scheduler.registerSchedule({ id: 'broadcast-scheduled', every: POLL_INTERVAL_MS, run: pollScheduled });
}
