import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { executeBroadcast } from './marketing.service.js';
import { agentVisibilityResolver } from '../../services/channel-visibility.js';
import { runCouponBroadcast, type CouponBroadcastDeps } from './broadcast-coupon.flow.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { inTenant } from '../../lib/tenant-ctx.js';
import { getEffectiveTenantPermissions } from '../../services/permission.service.js';
import { getTenantPlanId } from '../../services/tenant-plan.cache.js';
import {
  findSchedulingMember,
  markScheduledSendDenied,
  requiredSendPermissions,
  scheduledSendDenial,
  schedulingMemberId,
  type SendDenial,
} from './broadcast-send-authority.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Polls for scheduled broadcasts whose scheduledAt <= now and executes them.
 *
 * 附券廣播（couponId 有值）改由 runCouponBroadcast 以 app_tenant 的連線逐步發送（design D29），
 * 需要 couponDeps 的 app_tenant 基底連線與票券連結儲存（Redis）。「立即發送」與批次發券由
 * coupon-broadcast 佇列馬上執行（broadcast-coupon.worker.ts），這裡是後備：job 沒有執行時，時間到的廣播照樣發送。
 *
 * 送出前以排定送出的成員「當下」的有效權限重新檢查（change require-broadcast-send-permissions）：
 * 成員不存在、已停用或少了需要的權限時不送出，廣播標為失敗並寫 failureCode／failureReason。
 */
export function setupBroadcastScheduler(
  scheduler: JobScheduler,
  prisma: PrismaClient,
  io: SocketIOServer,
  couponDeps: Omit<CouponBroadcastDeps, 'io'>,
) {
  /** 排定送出的成員當下還能不能送這則廣播；可以時回 null */
  async function sendDenial(broadcast: {
    id: string; tenantId: string; createdById: string; scheduledById: string | null;
    couponId: string | null; couponIssuedVia: string | null;
  }): Promise<SendDenial | null> {
    const member = await inTenant(couponDeps.prisma, broadcast.tenantId, (ctx) =>
      findSchedulingMember(ctx, schedulingMemberId(broadcast)));
    // 有效權限 = 角色權限 ∩ 方案天花板，與 requirePermission 相同（排程器沒有 request，用 prismaAdmin 計算）
    const effective = member?.isActive
      ? await getEffectiveTenantPermissions(prisma, member.roleId, await getTenantPlanId(prisma, broadcast.tenantId))
      : new Set<string>();
    return scheduledSendDenial(member, effective, requiredSendPermissions(broadcast));
  }

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
          const denial = await sendDenial(broadcast);
          if (denial) {
            const marked = await inTenant(couponDeps.prisma, broadcast.tenantId, (ctx) => markScheduledSendDenied(ctx, broadcast.id, denial));
            logger.warn('[BroadcastScheduler] 排定的成員沒有發送權限，廣播沒有發送', {
              tenantId: broadcast.tenantId, broadcastId: broadcast.id, code: denial.code, missingPermission: denial.missingPermission, marked,
            });
            continue;
          }
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
