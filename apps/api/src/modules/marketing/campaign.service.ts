import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';

export async function listCampaigns(
  prisma: PrismaClient,
  tenantId: string,
  filters: { status?: string; page?: number; limit?: number } = {},
) {
  const { status, page = 1, limit = 50 } = filters;
  const where: Record<string, unknown> = { tenantId };
  if (status) where.status = status;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { broadcasts: true } },
      },
    }),
    prisma.campaign.count({ where: where as any }),
  ]);

  return { campaigns, total, page, limit };
}

export async function getCampaign(prisma: PrismaClient, id: string, tenantId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId },
    include: {
      broadcasts: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!campaign) {
    throw new AppError('Campaign not found', 'NOT_FOUND', 404);
  }

  // Aggregate basic metrics from broadcasts
  const basicMetrics = aggregateBroadcastMetrics(campaign.broadcasts);

  // Aggregate reply/case metrics from BroadcastRecipient
  const broadcastIds = campaign.broadcasts.map((b) => b.id);
  let replied = 0;
  let casesOpened = 0;

  if (broadcastIds.length > 0) {
    const [repliedResult, casesResult] = await Promise.all([
      prisma.broadcastRecipient.count({
        where: { broadcastId: { in: broadcastIds }, replied: true },
      }),
      prisma.broadcastRecipient.count({
        where: { broadcastId: { in: broadcastIds }, caseId: { not: null } },
      }),
    ]);
    replied = repliedResult;
    casesOpened = casesResult;
  }

  const metrics = {
    ...basicMetrics,
    replied,
    casesOpened,
    replyRate: basicMetrics.delivered > 0 ? Math.round((replied / basicMetrics.delivered) * 100) : 0,
  };

  return { ...campaign, metrics };
}

export async function createCampaign(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  data: {
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
  },
) {
  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description || null,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      createdById: agentId,
    },
  });
  return campaign;
}

export async function updateCampaign(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    name?: string;
    description?: string;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError('Campaign not found', 'NOT_FOUND', 404);
  }

  // Validate status transitions
  if (data.status) {
    const validTransitions: Record<string, string[]> = {
      draft: ['active', 'cancelled'],
      active: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };
    const allowed = validTransitions[existing.status] || [];
    if (!allowed.includes(data.status)) {
      throw new AppError(
        `Cannot transition from ${existing.status} to ${data.status}`,
        'INVALID_TRANSITION',
        400,
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
  });
  return campaign;
}

export async function deleteCampaign(prisma: PrismaClient, id: string, tenantId: string) {
  const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError('Campaign not found', 'NOT_FOUND', 404);
  }
  if (existing.status !== 'draft') {
    throw new AppError('Only draft campaigns can be deleted', 'FORBIDDEN', 403);
  }
  await prisma.campaign.delete({ where: { id } });
  return { deleted: true };
}

function aggregateBroadcastMetrics(broadcasts: Array<{
  totalCount: number;
  successCount: number;
  failedCount: number;
  status: string;
}>) {
  let totalSent = 0;
  let delivered = 0;
  let failed = 0;
  let broadcastCount = broadcasts.length;

  for (const b of broadcasts) {
    totalSent += b.totalCount;
    delivered += b.successCount;
    failed += b.failedCount;
  }

  return {
    broadcastCount,
    totalSent,
    delivered,
    failed,
    deliveryRate: totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0,
  };
}
