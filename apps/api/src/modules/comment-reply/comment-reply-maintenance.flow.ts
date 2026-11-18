/**
 * 留言自動私訊的維運排程（change add-comment-keyword-private-reply design D2、D25、D26）。
 *
 * - recover（每 5 分鐘）：PENDING 超過 10 分鐘沒有進展、SENDING 超過 2 分鐘 → 再排一次工作（消費者冪等）；
 *   留言時間已過 7 天（含 10 分鐘安全邊際）的 PENDING／SENDING → EXPIRED/WINDOW_EXPIRED。
 * - retention（每小時）：刪除早於 logRetentionDays 的紀錄（每批 5,000 筆、單次最多 60 秒）；
 *   每月用量保留 25 個月。
 * 跨租戶的掃描以 prismaAdmin 只讀出 (tenantId, id)，寫入一律逐租戶 inTenant()。
 */
import type { PrismaClient } from '@prisma/client';
import { logger, taipeiMonthString } from '@open333crm/core';
import { inTenant } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher, type EventPublisher } from '../../events/outbox-publisher.js';
import { COMMENT_REPLY_WINDOW_MS, COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS } from './comment-reply-expiry.js';
import { SENDING_STALE_MS } from './comment-reply-delivery.service.js';
import { readCommentReplyPlatformSettings } from './comment-reply-platform-settings.js';
import { enqueueCommentReplyDelivery } from './comment-reply-enqueue.js';

/** PENDING 這麼久沒有進展視為工作遺失（D2） */
export const PENDING_STALE_MS = 10 * 60_000;
const RECOVER_BATCH = 500;

export interface MaintenanceDeps {
  /** 跨租戶唯讀掃描（BYPASSRLS） */
  admin: PrismaClient;
  /** app_tenant 連線：寫入逐租戶 inTenant() */
  prisma: PrismaClient;
  events?: EventPublisher;
  now?: () => Date;
}

function groupByTenant(rows: Array<{ tenantId: string; id: string }>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.tenantId, [...(map.get(r.tenantId) ?? []), r.id]);
  return map;
}

export async function runCommentReplyRecover(deps: MaintenanceDeps): Promise<{ requeued: number; expired: number }> {
  const now = deps.now?.() ?? new Date();
  const expireBefore = new Date(now.getTime() - (COMMENT_REPLY_WINDOW_MS - COMMENT_REPLY_WINDOW_SAFETY_MARGIN_MS));
  const pendingBefore = new Date(now.getTime() - PENDING_STALE_MS);
  const sendingBefore = new Date(now.getTime() - SENDING_STALE_MS);

  const expired = await deps.admin.$queryRaw<Array<{ tenantId: string; id: string }>>`
    SELECT "tenantId", id FROM comment_reply_logs
    WHERE status IN ('PENDING', 'SENDING') AND "commentCreatedAt" <= ${expireBefore}
    LIMIT ${RECOVER_BATCH}`;
  const stale = await deps.admin.$queryRaw<Array<{ tenantId: string; id: string }>>`
    (SELECT "tenantId", id FROM comment_reply_logs
      WHERE status = 'PENDING' AND coalesce("nextAttemptAt", "updatedAt") < ${pendingBefore}
        AND "commentCreatedAt" > ${expireBefore}
      LIMIT ${RECOVER_BATCH})
    UNION ALL
    (SELECT "tenantId", id FROM comment_reply_logs
      WHERE status = 'SENDING' AND "sendAttemptedAt" < ${sendingBefore}
        AND "commentCreatedAt" > ${expireBefore}
      LIMIT ${RECOVER_BATCH})`;

  let expiredCount = 0;
  for (const [tenantId, ids] of groupByTenant(expired)) {
    expiredCount += await inTenant(deps.prisma, tenantId, async (scope) => {
      const res = await scope.tx.commentReplyLog.updateMany({
        where: { tenantId, id: { in: ids }, status: { in: ['PENDING', 'SENDING'] } },
        data: { status: 'EXPIRED', reasonCode: 'WINDOW_EXPIRED', nextAttemptAt: null },
      });
      await scope.tx.commentReplyLog.updateMany({
        where: { tenantId, id: { in: ids }, status: 'EXPIRED', publicReplyStatus: { in: ['PENDING', 'SENDING'] } },
        data: { publicReplyStatus: 'SKIPPED', publicReplyReasonCode: 'PRIVATE_REPLY_NOT_SENT' },
      });
      return res.count;
    });
  }

  const publisher = deps.events ?? createOutboxPublisher(deps.prisma);
  let requeued = 0;
  for (const [tenantId, ids] of groupByTenant(stale)) {
    await inTenant(deps.prisma, tenantId, async (scope) => {
      for (const logId of ids) {
        await enqueueCommentReplyDelivery(scope, publisher, logId);
        requeued += 1;
      }
    });
  }
  if (requeued || expiredCount) logger.warn('[comment-reply-recover] 補回工作', { requeued, expired: expiredCount });
  return { requeued, expired: expiredCount };
}

/** 每月用量保留 25 個月（D26） */
export const USAGE_RETENTION_MONTHS = 25;
export const RETENTION_BATCH = 5_000;
export const RETENTION_MAX_MS = 60_000;

/** at 所在台灣月份往前 n 個月的 YYYY-MM */
export function monthsBefore(at: Date, n: number): string {
  const [y, m] = taipeiMonthString(at).split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export async function runCommentReplyRetention(
  deps: MaintenanceDeps & { batchSize?: number; maxMs?: number },
): Promise<{ deletedLogs: number; deletedUsages: number }> {
  const now = deps.now?.() ?? new Date();
  const started = Date.now();
  const batch = deps.batchSize ?? RETENTION_BATCH;
  const maxMs = deps.maxMs ?? RETENTION_MAX_MS;
  const settings = await readCommentReplyPlatformSettings(deps.admin);
  const cutoff = new Date(now.getTime() - settings.logRetentionDays * 86_400_000);
  const oldestMonth = monthsBefore(now, USAGE_RETENTION_MONTHS - 1);

  const tenants = await deps.admin.$queryRaw<Array<{ tenantId: string }>>`
    SELECT DISTINCT "tenantId" FROM comment_reply_logs WHERE "createdAt" < ${cutoff}`;
  let deletedLogs = 0;
  for (const { tenantId } of tenants) {
    for (;;) {
      if (Date.now() - started > maxMs) {
        logger.warn('[comment-reply-retention] 達單次時間上限，下次繼續', { deletedLogs });
        return { deletedLogs, deletedUsages: 0 };
      }
      const n = await inTenant(deps.prisma, tenantId, (scope) =>
        scope.tx.$executeRaw`
          DELETE FROM comment_reply_logs
          WHERE id IN (
            SELECT id FROM comment_reply_logs
            WHERE "tenantId" = ${tenantId}::uuid AND "createdAt" < ${cutoff}
            LIMIT ${batch})`,
      );
      deletedLogs += n;
      if (n < batch) break;
    }
  }

  const usageTenants = await deps.admin.$queryRaw<Array<{ tenantId: string }>>`
    SELECT DISTINCT "tenantId" FROM comment_reply_usages WHERE month < ${oldestMonth}`;
  let deletedUsages = 0;
  for (const { tenantId } of usageTenants) {
    deletedUsages += await inTenant(deps.prisma, tenantId, async (scope) =>
      (await scope.tx.commentReplyUsage.deleteMany({ where: { tenantId, month: { lt: oldestMonth } } })).count,
    );
  }
  if (deletedLogs || deletedUsages) logger.info('[comment-reply-retention] 清除過期資料', { deletedLogs, deletedUsages });
  return { deletedLogs, deletedUsages };
}
