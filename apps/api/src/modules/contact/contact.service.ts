import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';
import { addTagToTarget, removeTagFromTarget } from '../tag/tagging.service.js';
import { notFound } from '../../shared/messages/resource.js';
import { mergeContacts as runMergeEngine } from './contact-merge.service.js';

export interface ContactFilters {
  q?: string;
  tagId?: string;
  channelType?: string;
  excludeChannelType?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

function parseExcludedChannelTypes(channelType?: string) {
  return new Set(
    channelType
      ?.split(',')
      .map((type) => type.trim().toUpperCase())
      .filter(Boolean) ?? [],
  );
}

function combineChannelIdentityFilters(filters: Prisma.ChannelIdentityWhereInput[]) {
  if (filters.length === 1) return filters[0];
  return { AND: filters };
}

export async function listContacts(
  prisma: TenantDb,
  tenantId: string,
  filters: ContactFilters,
  pagination: PaginationParams,
) {
  const where: Prisma.ContactWhereInput = {
    tenantId,
    isArchived: false,
  };

  if (filters.q) {
    where.OR = [
      { displayName: { contains: filters.q, mode: 'insensitive' } },
      { phone: { contains: filters.q, mode: 'insensitive' } },
      { email: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  if (filters.tagId) {
    where.tags = {
      some: { tagId: filters.tagId },
    };
  }

  if (filters.channelType) {
    where.channelIdentities = {
      some: { channelType: filters.channelType as any },
    };
  }

  const excludedChannelTypes = parseExcludedChannelTypes(filters.excludeChannelType);
  const excludedChannelTypeValues = Array.from(excludedChannelTypes);
  const channelIdentityWhere = excludedChannelTypeValues.length > 0
    ? {
        AND: [
          { channelType: { notIn: excludedChannelTypeValues as any } },
          { channel: { is: { channelType: { notIn: excludedChannelTypeValues as any } } } },
        ],
      }
    : undefined;

  if (channelIdentityWhere) {
    where.channelIdentities = {
      some: combineChannelIdentityFilters([
        ...(filters.channelType ? [{ channelType: filters.channelType as any }] : []),
        channelIdentityWhere,
      ]),
    };
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: {
        channelIdentities: {
          ...(channelIdentityWhere ? { where: channelIdentityWhere } : {}),
          select: {
            id: true,
            channelType: true,
            uid: true,
            profileName: true,
            channel: {
              select: {
                id: true,
                displayName: true,
                channelType: true,
              },
            },
          },
        },
        tags: {
          include: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
                type: true,
                scope: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return { contacts, total };
}

export async function getContact(
  prisma: TenantDb,
  id: string,
  tenantId: string,
) {
  const contact = await prisma.contact.findFirst({
    where: { id, tenantId },
    include: {
      channelIdentities: {
        include: {
          channel: {
            select: {
              id: true,
              displayName: true,
              channelType: true,
            },
          },
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      attributes: true,
    },
  });

  if (!contact) {
    throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
  }

  return contact;
}

export async function updateContact(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  data: {
    displayName?: string;
    phone?: string | null;
    email?: string | null;
    language?: string;
    isBlocked?: boolean;
  },
) {
  const contact = await prisma.contact.findFirst({
    where: { id, tenantId },
  });

  if (!contact) {
    throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
  }

  const updated = await prisma.contact.update({
    where: { id },
    data,
    include: {
      channelIdentities: {
        select: {
          id: true,
          channelType: true,
          uid: true,
          profileName: true,
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
    },
  });

  return updated;
}

export async function getContactConversations(
  prisma: TenantDb,
  contactId: string,
  tenantId: string,
  page: number,
  limit: number,
) {
  const where: Prisma.ConversationWhereInput = {
    contactId,
    tenantId,
  };

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        channel: {
          select: {
            id: true,
            displayName: true,
            channelType: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            contentType: true,
            content: true,
            direction: true,
            senderType: true,
            createdAt: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.conversation.count({ where }),
  ]);

  const result = conversations.map((conv) => {
    const { messages, ...rest } = conv;
    return {
      ...rest,
      lastMessage: messages[0] ?? null,
    };
  });

  return { conversations: result, total };
}

export async function getContactCases(
  prisma: TenantDb,
  contactId: string,
  tenantId: string,
  page: number,
  limit: number,
) {
  const where: Prisma.CaseWhereInput = {
    contactId,
    tenantId,
  };

  const [cases, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.case.count({ where }),
  ]);

  return { cases, total };
}

export async function addContactTag(
  prisma: TenantDb,
  contactId: string,
  tenantId: string,
  tagId: string,
  agentId: string,
) {
  return addTagToTarget(prisma, {
    tenantId,
    targetType: 'CONTACT',
    targetId: contactId,
    tagId,
    agentId,
  });
}

export async function removeContactTag(
  prisma: TenantDb,
  contactId: string,
  tenantId: string,
  tagId: string,
) {
  return removeTagFromTarget(prisma, {
    tenantId,
    targetType: 'CONTACT',
    targetId: contactId,
    tagId,
  });
}

export interface TimelineEntry {
  type: 'conversation' | 'case' | 'case_event' | 'tag';
  timestamp: string;
  data: Record<string, unknown>;
}

export async function getContactTimeline(
  prisma: TenantDb,
  contactId: string,
  tenantId: string,
) {
  // Verify contact exists
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
  });
  if (!contact) {
    throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
  }

  // Fetch conversations, cases, case events, and tags in parallel
  const [conversations, cases, contactTags] = await Promise.all([
    prisma.conversation.findMany({
      where: { contactId, tenantId },
      select: {
        id: true,
        channelType: true,
        status: true,
        createdAt: true,
        channel: {
          select: { displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.case.findMany({
      where: { contactId, tenantId },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        events: {
          select: {
            id: true,
            eventType: true,
            payload: true,
            actorType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contactTag.findMany({
      where: { contactId },
      include: {
        tag: {
          select: { name: true, color: true, type: true },
        },
      },
      orderBy: { addedAt: 'desc' },
    }),
  ]);

  const timeline: TimelineEntry[] = [];

  // Add conversation entries
  for (const conv of conversations) {
    timeline.push({
      type: 'conversation',
      timestamp: conv.createdAt.toISOString(),
      data: {
        id: conv.id,
        channelType: conv.channelType,
        status: conv.status,
        channelName: conv.channel.displayName,
      },
    });
  }

  // Add case entries and their events
  for (const c of cases) {
    timeline.push({
      type: 'case',
      timestamp: c.createdAt.toISOString(),
      data: {
        id: c.id,
        title: c.title,
        status: c.status,
        priority: c.priority,
      },
    });

    for (const event of c.events) {
      timeline.push({
        type: 'case_event',
        timestamp: event.createdAt.toISOString(),
        data: {
          id: event.id,
          caseId: c.id,
          caseTitle: c.title,
          eventType: event.eventType,
          payload: event.payload as Record<string, unknown>,
          actorType: event.actorType,
        },
      });
    }
  }

  // Add tag entries
  for (const ct of contactTags) {
    timeline.push({
      type: 'tag',
      timestamp: ct.addedAt.toISOString(),
      data: {
        id: ct.id,
        tagName: ct.tag.name,
        tagColor: ct.tag.color,
        tagType: ct.tag.type,
        addedBy: ct.addedBy,
      },
    });
  }

  // Sort by timestamp descending (most recent first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return timeline;
}

export async function getMergePreview(
  prisma: TenantDb,
  tenantId: string,
  primaryId: string,
  secondaryId: string,
) {
  const [primary, secondary] = await Promise.all([
    prisma.contact.findFirst({
      where: { id: primaryId, tenantId },
      include: {
        channelIdentities: {
          select: { id: true, channelType: true, uid: true, profileName: true, channelId: true },
        },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        attributes: { select: { id: true, key: true, value: true } },
        _count: { select: { conversations: true, cases: true } },
      },
    }),
    prisma.contact.findFirst({
      where: { id: secondaryId, tenantId },
      include: {
        channelIdentities: {
          select: { id: true, channelType: true, uid: true, profileName: true, channelId: true },
        },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        attributes: { select: { id: true, key: true, value: true } },
        _count: { select: { conversations: true, cases: true } },
      },
    }),
  ]);

  if (!primary) throw new AppError(notFound('primaryContact'), 'NOT_FOUND', 404);
  if (!secondary) throw new AppError(notFound('secondaryContact'), 'NOT_FOUND', 404);
  if (secondary.isArchived) throw new AppError('次要聯絡人已被封存或合併，無法再次合併', 'BAD_REQUEST', 400);

  // Channel identities: secondary has but primary doesn't (by channelType)
  const primaryChannelTypes = new Set(primary.channelIdentities.map((ci) => ci.channelType));
  const newChannelIdentities = secondary.channelIdentities.filter(
    (ci) => !primaryChannelTypes.has(ci.channelType),
  );

  // Tags: secondary has but primary doesn't (by tagId)
  const primaryTagIds = new Set(primary.tags.map((t) => t.tag.id));
  const newTags = secondary.tags.filter((t) => !primaryTagIds.has(t.tag.id));

  // Attributes: secondary has but primary doesn't (by key)
  const primaryAttrKeys = new Set(primary.attributes.map((a) => a.key));
  const newAttributes = secondary.attributes.filter((a) => !primaryAttrKeys.has(a.key));

  return {
    primary: {
      id: primary.id,
      displayName: primary.displayName,
      phone: primary.phone,
      email: primary.email,
      avatarUrl: primary.avatarUrl,
      channelIdentities: primary.channelIdentities,
      tags: primary.tags.map((t) => t.tag),
      attributes: primary.attributes,
      conversationsCount: primary._count.conversations,
      casesCount: primary._count.cases,
    },
    secondary: {
      id: secondary.id,
      displayName: secondary.displayName,
      phone: secondary.phone,
      email: secondary.email,
      avatarUrl: secondary.avatarUrl,
      channelIdentities: secondary.channelIdentities,
      tags: secondary.tags.map((t) => t.tag),
      attributes: secondary.attributes,
      conversationsCount: secondary._count.conversations,
      casesCount: secondary._count.cases,
    },
    diff: {
      newChannelIdentities,
      newTags: newTags.map((t) => t.tag),
      newAttributes,
      totalConversations: primary._count.conversations + secondary._count.conversations,
      totalCases: primary._count.cases + secondary._count.cases,
    },
  };
}

export async function mergeContacts(
  prisma: TenantDb,
  io: SocketIOServer,
  tenantId: string,
  primaryContactId: string,
  secondaryContactId: string,
  actorAgentId?: string,
) {
  // 外層 withTenant 交易保證原子（不自開 $transaction，避免巢狀）；
  // 實際搬移由統一合併引擎負責（見 contact-merge.service.ts）
  const result = await runMergeEngine(prisma, {
    tenantId,
    survivorId: primaryContactId,
    mergedId: secondaryContactId,
    source: 'MANUAL',
    actorAgentId,
  });

  io.to(`tenant:${tenantId}`).emit('contact.merged', {
    primaryContactId,
    secondaryContactId,
    primaryName: result.survivor.displayName,
    secondaryName: result.merged.displayName,
  });

  return {
    primaryContactId,
    secondaryContactId,
    primaryName: result.survivor.displayName,
    secondaryName: result.merged.displayName,
    mergeLogId: result.mergeLogId,
  };
}
