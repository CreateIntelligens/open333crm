/**
 * outbox 的補送與清理排程（change outbox-event-delivery，design 決策 6）。
 *
 * - outbox-relay：每分鐘補送建立超過 2 分鐘、還沒標記已送出的資料列。寬限時間留給快路徑，
 *   避免和剛 commit 的交易搶著送。快路徑與補送同時送出時，BullMQ 以 job id 擋住重複。
 * - outbox-cleanup：每天刪除已送出超過 7 天的 outbox，與建立超過 30 天的認領紀錄。
 *
 * 兩者都跨租戶，用 prismaAdmin。
 */
import type { PrismaClient } from '@prisma/client';
import { dispatchOutboxRows, getOutboxQueue, logger, type GetQueue } from '@open333crm/core';
import type { JobScheduler } from '../../lib/job-scheduler.js';

const RELAY_GRACE_MS = 2 * 60_000;
const RELAY_BATCH = 500;
const OUTBOX_RETENTION_MS = 7 * 86_400_000;
const CLAIM_RETENTION_MS = 30 * 86_400_000;

type OutboxDb = Pick<PrismaClient, 'outbox' | 'sideEffectClaim'>;

export async function runOutboxRelay(db: OutboxDb, now = new Date(), getQueue: GetQueue = getOutboxQueue): Promise<void> {
  const rows = await db.outbox.findMany({
    where: { dispatchedAt: null, createdAt: { lt: new Date(now.getTime() - RELAY_GRACE_MS) } },
    orderBy: { createdAt: 'asc' },
    take: RELAY_BATCH,
    select: { id: true, tenantId: true, kind: true, name: true, queueName: true, payload: true, jobOptions: true, createdAt: true },
  });
  if (rows.length === 0) return;
  logger.warn(`[outbox-relay] 補送 ${rows.length} 筆快路徑沒有送出的資料列`);
  await dispatchOutboxRows(db, rows, getQueue);
}

export async function runOutboxCleanup(db: OutboxDb, now = new Date()): Promise<void> {
  const outbox = await db.outbox.deleteMany({
    where: { dispatchedAt: { lt: new Date(now.getTime() - OUTBOX_RETENTION_MS) } },
  });
  const claims = await db.sideEffectClaim.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CLAIM_RETENTION_MS) } },
  });
  logger.info(`[outbox-cleanup] 刪除 outbox ${outbox.count} 筆、認領紀錄 ${claims.count} 筆`);
}

export function setupOutboxSchedulers(scheduler: JobScheduler, prismaAdmin: PrismaClient): void {
  scheduler.registerSchedule({
    id: 'outbox-relay',
    every: 60_000,
    // 一次最多 500 列，每列幾個 Redis 指令；Redis 很慢時才可能超過週期
    withoutOverlapping: { expiresInMs: 5 * 60_000 },
    run: () => runOutboxRelay(prismaAdmin),
  });
  scheduler.registerSchedule({
    id: 'outbox-cleanup',
    pattern: '30 3 * * *',
    run: () => runOutboxCleanup(prismaAdmin),
  });
}
