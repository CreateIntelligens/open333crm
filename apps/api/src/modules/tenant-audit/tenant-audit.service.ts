/**
 * 租戶層操作稽核。記錄租戶內敏感操作（改設定/刪聯絡人/匯出名單/改權限等），
 * 租戶 ADMIN 可查（有別於平台方看的 PlatformAuditLog）。
 *
 * - recordTenantAudit：在交易內寫，與主操作一起 commit；寫入失敗時丟錯，主操作一起 rollback。
 * - writeTenantAudit：舊寫法，給還沒搬成 TenantCtx 的呼叫端（#337）。非阻斷：寫入失敗只 log，不影響主操作。
 *   不能在交易內使用：接住資料庫錯誤後交易已經失效，之後的查詢與 COMMIT 都不會成功。
 */
import type { Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

export interface TenantAuditInput {
  tenantId: string;
  actorId?: string | null; // 系統/排程觸發時可為 null
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Prisma.InputJsonValue;
  ip?: string;
}

/** 在交易內寫一筆租戶稽核，tenantId 取自 ctx。失敗時丟錯，讓主操作一起 rollback。 */
export async function recordTenantAudit(ctx: TenantCtx, input: Omit<TenantAuditInput, 'tenantId'>): Promise<void> {
  await ctx.tx.tenantAuditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload,
      ip: input.ip,
    },
  });
}

/** 寫一筆租戶稽核（非阻斷：失敗只 log）。只用在交易之外。 */
export async function writeTenantAudit(prisma: TenantDb, input: TenantAuditInput): Promise<void> {
  try {
    await prisma.tenantAuditLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        payload: input.payload,
        ip: input.ip,
      },
    });
  } catch (err) {
    logger.error(`[TenantAudit] write failed action=${input.action} tenant=${input.tenantId}:`, err);
  }
}

export interface ListAuditParams {
  tenantId: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/** 查租戶稽核（分頁 + action/actor/日期篩選，一律 tenantId scoped）。 */
export async function listTenantAudit(prisma: TenantDb, params: ListAuditParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.TenantAuditLogWhereInput = {
    tenantId: params.tenantId,
    ...(params.action ? { action: params.action } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
    ...(params.from || params.to
      ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.tenantAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        payload: true,
        ip: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.tenantAuditLog.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}
