import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import { notFound } from '../../shared/messages/resource.js';

export interface SegmentRules {
  conditions: Array<{
    field: string;      // 'tag' | 'channelType' | 'createdAfter' | 'createdBefore'
    operator: string;   // 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'has'
    value?: unknown;
  }>;
  logic: 'AND' | 'OR';
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * 分群規則中「有值」的條件。值空白的條件不能拿來篩選：
 * Prisma 遇到 undefined 會略過條件，空字串也篩不出有意義的結果。
 */
export function effectiveSegmentConditions(rules: SegmentRules | null | undefined) {
  const conditions = Array.isArray(rules?.conditions) ? rules.conditions : [];
  return conditions.filter((c) => hasValue(c.value));
}

/**
 * 建立／修改分群時檢查規則：至少一條條件，且每條都要有值。
 * 沒有條件的分群以前會被當成「全部聯絡人」，拿去廣播就是全發。
 */
export function assertSegmentRulesHaveValues(rules: SegmentRules) {
  const conditions = Array.isArray(rules?.conditions) ? rules.conditions : [];
  const message =
    conditions.length === 0
      ? '分群至少要有一條條件'
      : conditions.some((c) => !hasValue(c.value))
        ? '每條條件都要選擇或填入值，請補齊或刪除空白的條件'
        : null;
  if (message) {
    throw new AppError(message, 'INVALID_SEGMENT_RULES', 400, {
      issues: [{ path: 'rules.conditions', message }],
    });
  }
}

export async function listSegments(
  prisma: TenantDb,
  tenantId: string,
  page = 1,
  limit = 50,
) {
  const where = { tenantId };
  const [segments, total] = await Promise.all([
    prisma.segment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.segment.count({ where }),
  ]);
  return { segments, total, page, limit };
}

export async function getSegment(prisma: TenantDb, id: string, tenantId: string) {
  const segment = await prisma.segment.findFirst({
    where: { id, tenantId },
  });
  if (!segment) {
    throw new AppError(notFound('segment'), 'NOT_FOUND', 404);
  }
  return segment;
}

export async function createSegment(
  prisma: TenantDb,
  tenantId: string,
  agentId: string,
  data: { name: string; description?: string; rules: SegmentRules },
) {
  assertSegmentRulesHaveValues(data.rules);
  // Calculate initial contact count
  const { contactIds } = await calculateSegmentContacts(prisma, tenantId, data.rules);

  const segment = await prisma.segment.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description || null,
      rules: data.rules as any,
      conditions: data.rules.conditions as any,
      contactCount: contactIds.length,
      createdById: agentId,
    },
  });
  return segment;
}

export async function updateSegment(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  data: { name?: string; description?: string; rules?: SegmentRules },
) {
  if (data.rules !== undefined) assertSegmentRulesHaveValues(data.rules);
  const existing = await prisma.segment.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError(notFound('segment'), 'NOT_FOUND', 404);
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.rules !== undefined) {
    updateData.rules = data.rules;
    updateData.conditions = data.rules.conditions;
    const { contactIds } = await calculateSegmentContacts(prisma, tenantId, data.rules);
    updateData.contactCount = contactIds.length;
  }

  const segment = await prisma.segment.update({
    where: { id },
    data: updateData,
  });
  return segment;
}

export async function deleteSegment(prisma: TenantDb, id: string, tenantId: string) {
  const existing = await prisma.segment.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError(notFound('segment'), 'NOT_FOUND', 404);
  }
  await prisma.segment.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Calculate contacts matching segment rules.
 * 沒有有效條件（值空白）的規則算 0 人，不是全部聯絡人。
 * Supported condition fields:
 *  - tag: contact has a specific tag (value = tagId)
 *  - channelType: contact has an identity on a specific channel type (value = 'LINE'|'FB'|...)
 *  - createdAfter: contact created after date (value = ISO date string)
 *  - createdBefore: contact created before date (value = ISO date string)
 */
export async function calculateSegmentContacts(
  prisma: TenantDb,
  tenantId: string,
  rules: SegmentRules,
): Promise<{ count: number; contactIds: string[] }> {
  const { logic } = rules;
  const conditions = effectiveSegmentConditions(rules);

  // 沒有有效條件 => 0 人（fail-closed）。以前回傳全部聯絡人，廣播會發給所有人
  if (conditions.length === 0) {
    return { count: 0, contactIds: [] };
  }

  const filters: any[] = [];

  for (const cond of conditions) {
    switch (cond.field) {
      case 'tag':
        filters.push({
          tags: { some: { tagId: cond.value as string } },
        });
        break;
      case 'channelType':
        filters.push({
          channelIdentities: { some: { channelType: cond.value as string } },
        });
        break;
      case 'createdAfter':
        filters.push({
          createdAt: { gte: new Date(cond.value as string) },
        });
        break;
      case 'createdBefore':
        filters.push({
          createdAt: { lte: new Date(cond.value as string) },
        });
        break;
    }
  }

  const where: any = {
    tenantId,
    isArchived: false,
  };

  if (logic === 'OR') {
    where.OR = filters;
  } else {
    where.AND = filters;
  }

  const contacts = await prisma.contact.findMany({
    where,
    select: { id: true },
  });

  return { count: contacts.length, contactIds: contacts.map((c) => c.id) };
}
