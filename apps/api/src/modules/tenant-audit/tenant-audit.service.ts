/**
 * 租戶層操作稽核。記錄租戶內敏感操作（改設定/刪聯絡人/匯出名單/改權限等），
 * 租戶 ADMIN 可查（有別於平台方看的 PlatformAuditLog）。
 *
 * writeTenantAudit 非阻斷：寫入失敗只 log，絕不影響主操作。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '@open333crm/core';

export interface TenantAuditInput {
  tenantId: string;
  actorId?: string | null; // 系統/排程觸發時可為 null
  action: string;
  targetType?: string;
  targetId?: string;
  payload?: Prisma.InputJsonValue;
  ip?: string;
}

/** 寫一筆租戶稽核（非阻斷：失敗只 log）。 */
export async function writeTenantAudit(prisma: PrismaClient, input: TenantAuditInput): Promise<void> {
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
export async function listTenantAudit(prisma: PrismaClient, params: ListAuditParams) {
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
