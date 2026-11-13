import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { type CouponBroadcastDeps } from './broadcast-coupon.flow.js';
import { createBroadcastJobRunner } from './broadcast-coupon.worker.js';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';

const POLL_INTERVAL_MS = 60_000; // 60 seconds
/**
 * 一期最久會跑多久（withoutOverlapping 的鎖存活時間）：一期最多處理 10 則，大名單的群發可能超過 60 秒。
 * 鎖到期後下一期才會開始；同一則廣播仍由條件更新保證只發送一次。
 */
const MAX_RUN_MS = 30 * 60_000;

/**
 * 每分鐘找出排程時間已到的廣播並發送（change fix-plain-broadcast-send-362）。
 *
 * 跨租戶的連線（prismaAdmin）只用來查到期清單（id、tenantId）與計算有效權限；每一則交給與 coupon-broadcast 佇列 job
 * 相同的執行函式（createBroadcastJobRunner）：租戶停用檢查 → 排定成員的發送權限重驗 → 發送。發送以 app_tenant 的連線
 * 綁定廣播的租戶執行（附券廣播每一步一個 inTenant()，一般群發每個查詢各自 withTenant()），RLS 有效。
 *
 * 「立即發送」由佇列馬上執行，這裡是後備：job 沒有執行時，時間到的廣播照樣發送；兩者誰先搶占誰發送。
 * 不能送時（租戶停用 TENANT_DISABLED、成員沒有權限 SCHEDULED_SENDER_*）廣播標為失敗並寫 failureCode／failureReason。
 */
export function setupBroadcastScheduler(
  scheduler: JobScheduler,
  prisma: PrismaClient,
  io: SocketIOServer,
  redis: Redis,
  couponDeps: Omit<CouponBroadcastDeps, 'io'>,
) {
  async function pollScheduled() {
    const run = createBroadcastJobRunner({ ...couponDeps, io, adminPrisma: prisma, redis });
    try {
      const due = await prisma.broadcast.findMany({
        where: {
          status: 'scheduled',
          scheduledAt: { lte: new Date() },
        },
        select: { id: true, tenantId: true, name: true },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      });

      for (const broadcast of due) {
        try {
          const result = (await run(broadcast.tenantId, broadcast.id)) as { status?: string } | undefined;
          logger.info(`[BroadcastScheduler] 廣播 ${broadcast.id}（${broadcast.name}）：${result?.status ?? 'done'}`);
        } catch (err) {
          // 失敗原因已寫進廣播（failureReason），後台看得到
          logger.error(`[BroadcastScheduler] Failed broadcast ${broadcast.id}:`, err);
        }
      }
    } catch (err) {
      logger.error('[BroadcastScheduler] Poll error:', err);
    }
  }

  scheduler.registerSchedule({
    id: 'broadcast-scheduled',
    every: POLL_INTERVAL_MS,
    withoutOverlapping: { expiresInMs: MAX_RUN_MS },
    run: pollScheduled,
  });
}
