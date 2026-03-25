/**
 * WebhookSubscription CRUD Service
 */

import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/utils/response.js';

export async function listSubscriptions(prisma: PrismaClient, tenantId: string) {
  return prisma.webhookSubscription.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { deliveries: true },
      },
    },
  });
}

export async function getSubscription(prisma: PrismaClient, id: string, tenantId: string) {
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id, tenantId },
  });
  if (!sub) throw new AppError('Webhook subscription not found', 'NOT_FOUND', 404);
  return sub;
}

export async function createSubscription(
  prisma: PrismaClient,
  tenantId: string,
  data: {
    url: string;
    events: string[];
    secret?: string;
    isActive?: boolean;
  },
) {
  const secret = data.secret || randomBytes(32).toString('hex');

  return prisma.webhookSubscription.create({
    data: {
      tenantId,
      url: data.url,
      events: data.events,
      secret,
      isActive: data.isActive ?? true,
    },
  });
}

export async function updateSubscription(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    url?: string;
    events?: string[];
    secret?: string;
    isActive?: boolean;
  },
) {
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id, tenantId },
  });
  if (!sub) throw new AppError('Webhook subscription not found', 'NOT_FOUND', 404);

  return prisma.webhookSubscription.update({
    where: { id },
    data,
  });
}

export async function deleteSubscription(prisma: PrismaClient, id: string, tenantId: string) {
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id, tenantId },
  });
  if (!sub) throw new AppError('Webhook subscription not found', 'NOT_FOUND', 404);

  await prisma.webhookSubscription.delete({ where: { id } });
  return { deleted: true };
}

export async function listDeliveries(
  prisma: PrismaClient,
  subscriptionId: string,
  tenantId: string,
  limit = 50,
) {
  // Verify subscription belongs to tenant
  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: subscriptionId, tenantId },
  });
  if (!sub) throw new AppError('Webhook subscription not found', 'NOT_FOUND', 404);

  return prisma.webhookDelivery.findMany({
    where: { subscriptionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
