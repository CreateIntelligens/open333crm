/**
 * 優惠券排程：作廢卡在發送中的對話發券（add-coupon-system design D16 第 5 步）。
 * 以 prismaAdmin（BYPASSRLS）跨租戶找出候選，再逐筆以 inTenant() 在該租戶的交易內作廢。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { logger } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';
import { inTenant } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher } from '../../events/outbox-publisher.js';
import { STALE_PENDING_MS, voidPendingInstance } from './coupon-inbox.service.js';

/** 作廢發送中超過 5 分鐘的券；回傳作廢張數。重跑也安全：只作廢仍在發送中的券 */
export async function sweepStalePendingIssues(
  clients: { admin: PrismaClient; prisma: PrismaClient },
  now: number,
  io?: Server,
): Promise<number> {
  const { admin, prisma } = clients;
  const stale = await admin.couponInstance.findMany({
    where: { deliveryPendingAt: { lt: new Date(now - STALE_PENDING_MS) } },
    select: { id: true, tenantId: true },
    take: 200,
  });
  let swept = 0;
  for (const row of stale) {
    try {
      const removed = await inTenant({ prisma, io, events: createOutboxPublisher(prisma) }, row.tenantId, (ctx) =>
        voidPendingInstance(ctx, row.id));
      if (removed) {
        swept += 1;
        logger.warn('[CouponScheduler] 發送中超過 5 分鐘，券已作廢', { tenantId: row.tenantId, instanceId: row.id });
      }
    } catch (err) {
      logger.error('[CouponScheduler] 作廢卡住的券失敗', { tenantId: row.tenantId, instanceId: row.id, error: (err as Error).message });
    }
  }
  return swept;
}

export function setupCouponScheduler(scheduler: JobScheduler, clients: { admin: PrismaClient; prisma: PrismaClient }) {
  scheduler.registerSchedule({
    id: 'coupon-stale-pending-issue',
    every: 60_000,
    withoutOverlapping: { expiresInMs: 5 * 60_000 },
    run: async () => {
      const swept = await sweepStalePendingIssues(clients, Date.now());
      if (swept > 0) logger.warn(`[CouponScheduler] 作廢 ${swept} 張卡在發送中的券`);
    },
  });
}
