import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Server as SocketIOServer } from 'socket.io';
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

export async function createAndDispatch(
  prisma: TenantDb,
  io: SocketIOServer,
  input: CreateNotificationInput,
) {
  const notification = await prisma.notification.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      type: input.type,
      title: input.title,
      body: input.body,
      clickUrl: input.clickUrl,
    },
  });

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

export type EscalationNotifyTarget = 'supervisor' | 'original_assignee';

/**
 * 升級工單時要通知的客服 id（不重複）。
 * - supervisor：同租戶在職的主管與管理員
 * - original_assignee：升級前的指派人（同租戶、在職，且不是升級的客服本人）
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

  return [...ids];
}
