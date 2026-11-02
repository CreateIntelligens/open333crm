import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';
import { ALL_CHANNELS, channelIdWhere, channelIdWhereFilter, type AccessibleChannels } from '../../services/channel-visibility.js';

/**
 * 非總店看得到的行銷活動（channel-scoped-visibility「行銷活動的可見範圍」）：自己建立的，
 * 或至少有一則可見渠道群發的。其他成員還沒有群發的活動與只有其他分店群發的活動都不列出。總店回空物件。
 */
export function readableCampaignWhere(accessibleChannels: AccessibleChannels, agentId: string) {
  const channelId = channelIdWhereFilter(accessibleChannels);
  return channelId ? { OR: [{ createdById: agentId }, { broadcasts: { some: { channelId } } }] } : {};
}

/**
 * 修改、刪除活動，或把群發加進活動之前：活動還有不可見渠道的群發時回 403，
 * 這些操作會影響其他分店的群發。campaign 以 readableCampaignWhere() 讀出，含群發的 channelId。
 */
export function assertCampaignWritable(
  campaign: { broadcasts: Array<{ channelId: string }> },
  accessibleChannels: AccessibleChannels,
): void {
  if (accessibleChannels === ALL_CHANNELS) return;
  if (campaign.broadcasts.some((b) => !accessibleChannels.has(b.channelId))) {
    throw new AppError('這個行銷活動有其他分店渠道的群發，修改請由總店處理', 'CAMPAIGN_HAS_OTHER_CHANNELS', 403);
  }
}

export async function listCampaigns(
  prisma: TenantDb,
  tenantId: string,
  filters: { status?: string; page?: number; limit?: number },
  /** 群發數只計可見渠道；必填，避免新呼叫端漏傳 */
  accessibleChannels: AccessibleChannels,
  agentId: string,
) {
  const { status, page = 1, limit = 50 } = filters;
  const where: Record<string, unknown> = { tenantId, ...readableCampaignWhere(accessibleChannels, agentId) };
  if (status) where.status = status;

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { broadcasts: { where: channelIdWhere(accessibleChannels) } } },
      },
    }),
    prisma.campaign.count({ where: where as any }),
  ]);

  return { campaigns, total, page, limit };
}

export async function getCampaign(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  /** 群發清單與成效只計可見渠道；必填，避免新呼叫端漏傳 */
  accessibleChannels: AccessibleChannels,
  agentId: string,
) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId, ...readableCampaignWhere(accessibleChannels, agentId) },
    include: {
      broadcasts: {
        where: channelIdWhere(accessibleChannels),
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
  /** 看不到的活動回 404、有其他分店群發的回 403；必填，避免新呼叫端漏傳 */
  accessibleChannels: AccessibleChannels,
  agentId: string,
) {
  const existing = await prisma.campaign.findFirst({
    where: { id, tenantId, ...readableCampaignWhere(accessibleChannels, agentId) },
    include: { broadcasts: { select: { channelId: true } } },
  });
  if (!existing) {
    throw new AppError(notFound('campaign'), 'NOT_FOUND', 404);
  }
  assertCampaignWritable(existing, accessibleChannels);

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
  // 有改日期才比對（以更新後的起訖：只改其中一個時，另一個沿用既有值）。
  // 只改狀態、名稱時不檢查：修正前建立的起訖相反活動仍要能啟動、完成或取消
  if (startDate !== undefined || endDate !== undefined) {
    assertCampaignPeriod(
      startDate === undefined ? existing.startDate : startDate,
      endDate === undefined ? existing.endDate : endDate,
    );
  }
  if (startDate !== undefined) updateData.startDate = startDate;
  if (endDate !== undefined) updateData.endDate = endDate;

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
  });
  return campaign;
}

export async function deleteCampaign(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  /** 看不到的活動回 404、有其他分店群發的回 403；必填，避免新呼叫端漏傳 */
  accessibleChannels: AccessibleChannels,
  agentId: string,
) {
  const existing = await prisma.campaign.findFirst({
    where: { id, tenantId, ...readableCampaignWhere(accessibleChannels, agentId) },
    include: { broadcasts: { select: { channelId: true } } },
  });
  if (!existing) {
    throw new AppError(notFound('campaign'), 'NOT_FOUND', 404);
  }
  assertCampaignWritable(existing, accessibleChannels);
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
