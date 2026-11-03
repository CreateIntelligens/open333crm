import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { executeBroadcast } from './marketing.service.js';
import { agentVisibilityResolver } from '../../services/channel-visibility.js';
import { runCouponBroadcast, type CouponBroadcastDeps } from './broadcast-coupon.flow.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { rejectUnauthorizedScheduledSend } from './broadcast-send-authority.js';
import { rejectDisabledTenantSend } from './broadcast-tenant-active.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Polls for scheduled broadcasts whose scheduledAt <= now and executes them.
 *
 * 附券廣播（couponId 有值）改由 runCouponBroadcast 以 app_tenant 的連線逐步發送（design D29），
 * 需要 couponDeps 的 app_tenant 基底連線與票券連結儲存（Redis）。「立即發送」與批次發券由
 * coupon-broadcast 佇列馬上執行（broadcast-coupon.worker.ts），這裡是後備：job 沒有執行時，時間到的廣播照樣發送。
 *
 * 送出前以排定送出的成員「當下」的有效權限重新檢查（change require-broadcast-send-permissions；佇列 job 也檢查）：
 * 成員不存在、已停用或少了需要的權限時不送出，廣播標為失敗並寫 failureCode／failureReason。
 *
 * 租戶停用（含試用到期）時也不送出，廣播標為失敗（failureCode = TENANT_DISABLED，issue #410；broadcast-tenant-active.ts）。
 */
export function setupBroadcastScheduler(
  scheduler: JobScheduler,
  prisma: PrismaClient,
  io: SocketIOServer,
  couponDeps: Omit<CouponBroadcastDeps, 'io'>,
) {
  async function pollScheduled() {
    const authorityDeps = { prisma: couponDeps.prisma, adminPrisma: prisma };
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
          // 租戶已停用時標為失敗、不送出（broadcast-tenant-active.ts，issue #410）
          if (await rejectDisabledTenantSend(couponDeps, broadcast.tenantId, broadcast.id)) continue;
          // 排定的成員當下沒有發送權限時標為失敗、不送出（broadcast-send-authority.ts）
          if (await rejectUnauthorizedScheduledSend(authorityDeps, broadcast.tenantId, broadcast)) continue;
          if (broadcast.couponId) {
            const result = await runCouponBroadcast({ ...couponDeps, io }, broadcast.tenantId, broadcast.id);
            logger.info(`[BroadcastScheduler] 附券廣播 ${broadcast.id}（${broadcast.name}）：${result.status}`);
            continue;
          }
          await executeBroadcast(prisma, io, broadcast.id, agentVisibilityResolver(prisma));
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
