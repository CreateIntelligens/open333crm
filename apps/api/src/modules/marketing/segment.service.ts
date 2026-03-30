import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';

export interface SegmentRules {
  conditions: Array<{
    field: string;      // 'tag' | 'channelType' | 'createdAfter' | 'createdBefore'
    operator: string;   // 'eq' | 'neq' | 'gt' | 'lt' | 'in' | 'has'
    value?: unknown;
  }>;
  logic: 'AND' | 'OR';
}

export async function listSegments(
  prisma: PrismaClient,
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

export async function getSegment(prisma: PrismaClient, id: string, tenantId: string) {
  const segment = await prisma.segment.findFirst({
    where: { id, tenantId },
  });
  if (!segment) {
    throw new AppError('Segment not found', 'NOT_FOUND', 404);
  }
  return segment;
}

export async function createSegment(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  data: { name: string; description?: string; rules: SegmentRules },
) {
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
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: { name?: string; description?: string; rules?: SegmentRules },
) {
  const existing = await prisma.segment.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError('Segment not found', 'NOT_FOUND', 404);
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

export async function deleteSegment(prisma: PrismaClient, id: string, tenantId: string) {
  const existing = await prisma.segment.findFirst({ where: { id, tenantId } });
  if (!existing) {
    throw new AppError('Segment not found', 'NOT_FOUND', 404);
  }
  await prisma.segment.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Calculate contacts matching segment rules.
 * Supported condition fields:
 *  - tag: contact has a specific tag (value = tagId)
 *  - channelType: contact has an identity on a specific channel type (value = 'LINE'|'FB'|...)
 *  - createdAfter: contact created after date (value = ISO date string)
 *  - createdBefore: contact created before date (value = ISO date string)
 */
export async function calculateSegmentContacts(
  prisma: PrismaClient,
  tenantId: string,
  rules: SegmentRules,
): Promise<{ count: number; contactIds: string[] }> {
  const { conditions, logic } = rules;

  if (!conditions || conditions.length === 0) {
    // No conditions => all contacts
    const contacts = await prisma.contact.findMany({
      where: { tenantId, isArchived: false },
      select: { id: true },
    });
    return { count: contacts.length, contactIds: contacts.map((c) => c.id) };
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
