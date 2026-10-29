/**
 * WebhookSubscription CRUD Service
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

export async function listSubscriptions({ tx, tenantId }: TenantCtx) {
  return tx.webhookSubscription.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { deliveries: true },
      },
    },
  });
}

export async function getSubscription({ tx, tenantId }: TenantCtx, id: string) {
  const sub = await tx.webhookSubscription.findFirst({
    where: { id, tenantId },
  });
  if (!sub) throw new AppError(notFound('webhookSubscription'), 'NOT_FOUND', 404);
  return sub;
}

export async function createSubscription(
  { tx, tenantId }: TenantCtx,
  data: {
    url: string;
    events: string[];
    secret?: string;
    isActive?: boolean;
  },
) {
  const secret = data.secret || randomBytes(32).toString('hex');

  return tx.webhookSubscription.create({
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
  { tx, tenantId }: TenantCtx,
  id: string,
  data: {
    url?: string;
    events?: string[];
    secret?: string;
    isActive?: boolean;
  },
) {
  const sub = await tx.webhookSubscription.findFirst({
    where: { id, tenantId },
  });
  if (!sub) throw new AppError(notFound('webhookSubscription'), 'NOT_FOUND', 404);

  return tx.webhookSubscription.update({
    where: { id },
    data,
  });
}

export async function deleteSubscription({ tx, tenantId }: TenantCtx, id: string) {
  const sub = await tx.webhookSubscription.findFirst({
    where: { id, tenantId },
  });
  if (!sub) throw new AppError(notFound('webhookSubscription'), 'NOT_FOUND', 404);

  await tx.webhookSubscription.delete({ where: { id } });
  return { deleted: true };
}

export async function listDeliveries({ tx, tenantId }: TenantCtx, subscriptionId: string, limit = 50) {
  // Verify subscription belongs to tenant
  const sub = await tx.webhookSubscription.findFirst({
    where: { id: subscriptionId, tenantId },
  });
  if (!sub) throw new AppError(notFound('webhookSubscription'), 'NOT_FOUND', 404);

  return tx.webhookDelivery.findMany({
    where: { subscriptionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
