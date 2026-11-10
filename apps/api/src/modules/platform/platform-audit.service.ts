/**
 * 平台稽核 log：寫入 helper 與查詢。平台側寫入操作（開通/停用租戶、改 plan、改設定）都應留一筆。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

export async function writePlatformAudit(
  prisma: PrismaClient,
  input: {
    platformUserId: string;
    action: string;
    targetType?: string;
    targetId?: string;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await prisma.platformAuditLog.create({
    data: {
      platformUserId: input.platformUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: input.payload,
    },
  });
}

/** 查詢稽核時一併帶出操作者的平台帳號（系統排程寫入者為 null） */
export const AUDIT_LOG_INCLUDE = {
  platformUser: { select: { id: true, name: true, email: true } },
} as const;

/** 帶操作者的稽核紀錄列（findMany + AUDIT_LOG_INCLUDE 的結果） */
export interface PlatformAuditLogRow {
  id: string;
  platformUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  platformUser: { id: string; name: string; email: string } | null;
}

/** API 回傳的稽核紀錄：附操作者、對象可讀名稱與對象所屬租戶（前端組連結用） */
export interface PlatformAuditEntry {
  id: string;
  platformUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  actor: { id: string; name: string; email: string } | null;
  targetLabel: string | null;
  targetTenantId: string | null;
}

interface TargetInfo {
  label: string | null;
  tenantId: string | null;
}

function payloadField(payload: Prisma.JsonValue | null, key: string): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * 依 targetType 分組，每種類型一次 findMany 解析對象名稱，避免逐筆查詢。
 * 查不到（已刪除、未知類型）時 label 為 null，前端退回顯示代碼。
 */
async function resolveTargets(
  prisma: PrismaClient,
  rows: PlatformAuditLogRow[],
): Promise<Map<string, TargetInfo>> {
  const idsOf = (type: string) => [
    ...new Set(rows.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId!)),
  ];
  const info = new Map<string, TargetInfo>();
  const key = (type: string, id: string) => `${type}:${id}`;

  const tenantIds = idsOf('tenant');
  const agentIds = idsOf('agent');
  const planIds = idsOf('plan');
  const requestIds = idsOf('plan_change_request');
  const userIds = idsOf('platform_user');
  const signupIds = idsOf('trial_signup');

  const [tenants, agents, plans, requests, users, signups] = await Promise.all([
    tenantIds.length
      ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
      : [],
    agentIds.length
      ? prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, email: true, tenantId: true } })
      : [],
    planIds.length ? prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } }) : [],
    requestIds.length
      ? prisma.planChangeRequest.findMany({
          where: { id: { in: requestIds } },
          select: { id: true, tenantId: true, tenant: { select: { name: true } } },
        })
      : [],
    userIds.length
      ? prisma.platformUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    signupIds.length
      ? prisma.trialSignup.findMany({ where: { id: { in: signupIds } }, select: { id: true, email: true, tenantId: true } })
      : [],
  ]);

  for (const t of tenants) info.set(key('tenant', t.id), { label: t.name, tenantId: t.id });
  for (const a of agents) info.set(key('agent', a.id), { label: a.email, tenantId: a.tenantId });
  for (const p of plans) info.set(key('plan', p.id), { label: p.name, tenantId: null });
  for (const r of requests) {
    info.set(key('plan_change_request', r.id), { label: r.tenant?.name ?? null, tenantId: r.tenantId });
  }
  for (const u of users) info.set(key('platform_user', u.id), { label: u.name, tenantId: null });
  for (const s of signups) info.set(key('trial_signup', s.id), { label: s.email, tenantId: s.tenantId });
  return info;
}

function fallbackTarget(row: PlatformAuditLogRow): TargetInfo {
  switch (row.targetType) {
    case 'tenant':
      // 租戶已不存在時仍保留 id，前端連結會落到「找不到」而不是消失
      return { label: null, tenantId: row.targetId };
    case 'agent':
      // 成員被刪除：退回寫入當下 payload 記的 email 與 tenantId
      return { label: payloadField(row.payload, 'email'), tenantId: payloadField(row.payload, 'tenantId') };
    case 'setting':
    case 'queue_job':
      // 設定 key 與 queue:jobId 本身可讀
      return { label: row.targetId, tenantId: null };
    default:
      return { label: null, tenantId: null };
  }
}

/** 為稽核紀錄附上操作者、對象名稱與對象所屬租戶 */
export async function describePlatformAuditLogs(
  prisma: PrismaClient,
  rows: PlatformAuditLogRow[],
): Promise<PlatformAuditEntry[]> {
  const targets = await resolveTargets(prisma, rows);
  return rows.map((row) => {
    const target =
      (row.targetType && row.targetId && targets.get(`${row.targetType}:${row.targetId}`)) || fallbackTarget(row);
    const { platformUser, ...rest } = row;
    return {
      ...rest,
      actor: platformUser ?? null,
      targetLabel: target.label,
      targetTenantId: target.tenantId,
    };
  });
}

export const TENANT_AUDIT_LOG_DEFAULT_LIMIT = 100;
export const TENANT_AUDIT_LOG_MAX_LIMIT = 200;

/**
 * 依租戶查平台稽核：對象是該租戶、該租戶成員（payload.tenantId）、該租戶方案申請的紀錄。
 * 成員以 payload.tenantId 判定而非成員 id 清單，被硬刪的成員紀錄才不會消失。
 * 多查一筆判定 hasMore。
 */
export async function listTenantPlatformAuditLogs(
  prisma: PrismaClient,
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<{ items: PlatformAuditEntry[]; hasMore: boolean }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new AppError(notFound('tenant'), 'NOT_FOUND', 404);

  const limit = opts.limit ?? TENANT_AUDIT_LOG_DEFAULT_LIMIT;
  const requests = await prisma.planChangeRequest.findMany({ where: { tenantId }, select: { id: true } });

  const rows = await prisma.platformAuditLog.findMany({
    where: {
      OR: [
        { targetType: 'tenant', targetId: tenantId },
        { targetType: 'agent', payload: { path: ['tenantId'], equals: tenantId } },
        ...(requests.length
          ? [{ targetType: 'plan_change_request', targetId: { in: requests.map((r) => r.id) } }]
          : []),
      ],
    },
    include: AUDIT_LOG_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  return { items: await describePlatformAuditLogs(prisma, rows.slice(0, limit)), hasMore };
}
