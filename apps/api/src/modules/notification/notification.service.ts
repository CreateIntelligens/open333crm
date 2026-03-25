import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';

export interface CreateNotificationInput {
  tenantId: string;
  agentId: string;
  type: string;
  title: string;
  body: string;
  clickUrl?: string;
}

export async function createAndDispatch(
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
  agentId: string,
  tenantId: string,
) {
  const count = await prisma.notification.count({
    where: { agentId, tenantId, isRead: false },
  });
  return count;
}

export async function markAsRead(
  prisma: PrismaClient,
  id: string,
  agentId: string,
  tenantId: string,
) {
  const notification = await prisma.notification.findFirst({
    where: { id, agentId, tenantId },
  });

  if (!notification) {
    throw new AppError('Notification not found', 'NOT_FOUND', 404);
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });

  return updated;
}

export async function markAllAsRead(
  prisma: PrismaClient,
  agentId: string,
  tenantId: string,
) {
  const result = await prisma.notification.updateMany({
    where: { agentId, tenantId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });

  return result.count;
}
