import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Server as SocketIOServer } from 'socket.io';
import { createNotificationForActiveAgent, logger, resolveImplied } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { loadPlanCeiling } from '../../services/permission.service.js';
import { getAccessibleChannelIds, isChannelAccessible } from '../../services/channel-visibility.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

export interface CreateNotificationInput {
  tenantId: string;
  agentId: string;
  type: string;
  title: string;
  body: string;
  clickUrl?: string;
}

/**
 * 寫入一則站內通知並推播給收件成員。
 * 收件成員已被永久刪除或已停用時不寫入、不推播，寫 info log 並回傳 null（#484）。
 */
export async function createAndDispatch(
  prisma: TenantDb,
  io: SocketIOServer,
  input: CreateNotificationInput,
) {
  const notification = await createNotificationForActiveAgent(prisma, input);
  if (!notification) {
    logger.info(`[Notification] 略過通知 ${input.type}：收件成員 ${input.agentId} 已不存在或已停用（tenant ${input.tenantId}）`);
    return null;
  }

  // Emit to agent-specific room
  io.to(`agent:${input.agentId}`).emit('notification.new', notification);

  return notification;
}

export async function listNotifications(
  prisma: TenantDb,
  agentId: string,
  tenantId: string,
  filters: { isRead?: boolean },
  pagination: { page: number; limit: number },
) {
  const where: { agentId: string; tenantId: string; isRead?: boolean } = {
    agentId,
    tenantId,
  };

  if (filters.isRead !== undefined) {
    where.isRead = filters.isRead;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications, total };
}

export async function getUnreadCount(
  prisma: TenantDb,
  agentId: string,
  tenantId: string,
) {
  const count = await prisma.notification.count({
    where: { agentId, tenantId, isRead: false },
  });
  return count;
}

export async function markAsRead(
  prisma: TenantDb,
  id: string,
  agentId: string,
  tenantId: string,
) {
  const notification = await prisma.notification.findFirst({
    where: { id, agentId, tenantId },
  });

  if (!notification) {
    throw new AppError(notFound('notification'), 'NOT_FOUND', 404);
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });

  return updated;
}

export async function markAllAsRead(
  prisma: TenantDb,
  agentId: string,
  tenantId: string,
) {
  const result = await prisma.notification.updateMany({
    where: { agentId, tenantId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return result.count;
}

/**
 * 「負責工單的成員」依這個權限碼判斷（issue #339 決定 5）：權限註冊表沒有「工單管理」碼，
 * case.assign（派工／改派給成員）最接近「安排人跟進」。預設的客服角色也有這個碼，租戶可在角色頁拿掉。
 */
export const CASE_MANAGER_PERMISSION = 'case.assign';

/**
 * 工單相關通知（目前是 CSAT 低分）的收件人（issue #339 決定 5，csat-survey「低分只通知負責工單的成員」）：
 * 同租戶、啟用中、有效權限（角色權限 ∩ 方案天花板，含 implies）含 case.assign，而且看得到這個渠道
 * （持 channel.view_all，或直綁、團隊授權該渠道）的成員。不看舊的角色列舉 role（AUDIT RBAC-03）。
 * 只查資料庫、不讀 Redis：進站管線與交易內都能呼叫。
 */
export async function resolveCaseManagerRecipients(ctx: TenantCtx, channelId: string): Promise<string[]> {
  const tenant = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { planId: true } });
  // 租戶沒有方案時不設天花板（與 getEffectiveTenantPermissions 相同）
  const ceiling = tenant?.planId ? await loadPlanCeiling(ctx.tx, tenant.planId) : null;

  const roles = await ctx.tx.role.findMany({
    where: { tenantId: ctx.tenantId },
    select: { id: true, permissions: { select: { permissionCode: true } } },
  });
  const effectiveByRole = new Map<string, Set<string>>();
  for (const role of roles) {
    const granted = resolveImplied(role.permissions.map((p) => p.permissionCode));
    effectiveByRole.set(role.id, ceiling ? new Set([...granted].filter((code) => ceiling.has(code))) : granted);
  }
  const managerRoleIds = [...effectiveByRole].filter(([, eff]) => eff.has(CASE_MANAGER_PERMISSION)).map(([id]) => id);
  if (managerRoleIds.length === 0) return [];

  const candidates = await ctx.tx.agent.findMany({
    where: { tenantId: ctx.tenantId, isActive: true, roleId: { in: managerRoleIds } },
    select: { id: true, roleId: true },
  });
  const recipients: string[] = [];
  for (const agent of candidates) {
    const hasViewAll = effectiveByRole.get(agent.roleId!)?.has('channel.view_all') ?? false;
    const accessible = await getAccessibleChannelIds(ctx.tx, { tenantId: ctx.tenantId, agentId: agent.id, hasViewAll });
    if (isChannelAccessible(accessible, channelId)) recipients.push(agent.id);
  }
  return recipients;
}

export type EscalationNotifyTarget = 'supervisor' | 'original_assignee';

/**
 * 升級工單時要通知的客服 id（不重複）。
 * - supervisor：同租戶在職的主管與管理員
 * - original_assignee：升級前的指派人（同租戶、在職）
 * 升級的客服本人一律不通知
 * notifyTargets 沒帶（舊呼叫端、自動化）時只通知主管與管理員；空陣列表示兩個都沒勾，不通知。
 */
export async function resolveEscalationRecipients(
  db: TenantDb,
  tenantId: string,
  input: { notifyTargets?: readonly string[]; previousAssigneeId?: string | null; actorId?: string | null },
): Promise<string[]> {
  const targets = input.notifyTargets ?? ['supervisor'];
  const ids = new Set<string>();

  if (targets.includes('supervisor')) {
    const supervisors = await db.agent.findMany({
      where: { tenantId, role: { in: ['SUPERVISOR', 'ADMIN'] }, isActive: true },
      select: { id: true },
    });
    for (const a of supervisors) ids.add(a.id);
  }

  const original = input.previousAssigneeId;
  if (targets.includes('original_assignee') && original && original !== input.actorId) {
    const found = await db.agent.findMany({
      where: { tenantId, id: { in: [original] }, isActive: true },
      select: { id: true },
    });
    for (const a of found) ids.add(a.id);
  }

  // 升級的客服本人不收自己的升級通知（主管自己升級時也一樣）
  if (input.actorId) ids.delete(input.actorId);
  return [...ids];
}
