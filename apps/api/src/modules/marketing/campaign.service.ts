import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

export async function listCampaigns(
  prisma: TenantDb,
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

export async function getCampaign(prisma: TenantDb, id: string, tenantId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId },
    include: {
      broadcasts: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!campaign) {
    throw new AppError(notFound('campaign'), 'NOT_FOUND', 404);
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

/** 回 400，details.issues 指出欄位（與 zod 驗證錯誤同格式） */
function fieldError(path: string, message: string): AppError {
  return new AppError(message, 'VALIDATION_ERROR', 400, { issues: [{ path, message }] });
}

/** 解析活動日期；undefined 表示沒傳、null 表示清除，無法解析時回 400 */
function parseCampaignDate(field: 'startDate' | 'endDate', value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null || value === '') return value === '' ? null : value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fieldError(field, '日期格式不正確');
  return date;
}

/** 結束日不可早於開始日（同一天可以） */
function assertCampaignPeriod(start: Date | null, end: Date | null): void {
  if (start && end && end < start) throw fieldError('endDate', '結束日期不可早於開始日期');
}

export async function createCampaign(
  prisma: TenantDb,
  tenantId: string,
  agentId: string,
  data: {
    name: string;
    description?: string;
    startDate?: string;
    endDate?: string;
  },
) {
  const startDate = parseCampaignDate('startDate', data.startDate) ?? null;
  const endDate = parseCampaignDate('endDate', data.endDate) ?? null;
  assertCampaignPeriod(startDate, endDate);

  const campaign = await prisma.campaign.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description || null,
      startDate,
      endDate,
      createdById: agentId,
    },
  });
  return campaign;
}

export async function updateCampaign(
  prisma: TenantDb,
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
    throw new AppError(notFound('campaign'), 'NOT_FOUND', 404);
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
  const startDate = parseCampaignDate('startDate', data.startDate);
  const endDate = parseCampaignDate('endDate', data.endDate);
  // 以更新後的起訖比對：只改其中一個時，另一個沿用既有值
  assertCampaignPeriod(
    startDate === undefined ? existing.startDate : startDate,
    endDate === undefined ? existing.endDate : endDate,
  );
  if (startDate !== undefined) updateData.startDate = startDate;
  if (endDate !== undefined) updateData.endDate = endDate;

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
  });
  return campaign;
}

export async function deleteCampaign(prisma: TenantDb, id: string, tenantId: string) {
  const existing = await prisma.campaign.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError(notFound('campaign'), 'NOT_FOUND', 404);
  }
  if (existing.status !== 'draft') {
    throw new AppError('僅草稿狀態的行銷活動可以刪除', 'FORBIDDEN', 403);
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
