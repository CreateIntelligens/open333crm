import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';
import { eventBus } from '../../events/event-bus.js';

export interface ContactFilters {
  q?: string;
  tagId?: string;
  channelType?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export async function listContacts(
  prisma: PrismaClient,
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

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
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
  prisma: PrismaClient,
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
    throw new AppError('Contact not found', 'NOT_FOUND', 404);
  }

  return contact;
}

export async function updateContact(
  prisma: PrismaClient,
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
    throw new AppError('Contact not found', 'NOT_FOUND', 404);
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
  prisma: PrismaClient,
  contactId: string,
  tenantId: string,
  tagId: string,
  agentId: string,
) {
  // Verify contact exists
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
  });
  if (!contact) {
    throw new AppError('Contact not found', 'NOT_FOUND', 404);
  }

  // Verify tag exists and belongs to tenant
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, tenantId },
  });
  if (!tag) {
    throw new AppError('Tag not found', 'NOT_FOUND', 404);
  }

  const contactTag = await prisma.contactTag.upsert({
    where: {
      contactId_tagId: { contactId, tagId },
    },
    update: {},
    create: {
      contactId,
      tagId,
      addedBy: 'agent',
      addedById: agentId,
    },
    include: {
      tag: true,
    },
  });

  // Publish to EventBus for automation
  eventBus.publish({
    name: 'contact.tagged',
    tenantId,
    timestamp: new Date(),
    payload: {
      contactId,
      tagId,
      tagName: tag.name,
    },
  });

  return contactTag;
}

export async function removeContactTag(
  prisma: PrismaClient,
  contactId: string,
  tenantId: string,
  tagId: string,
) {
  // Verify contact exists
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
  });
  if (!contact) {
    throw new AppError('Contact not found', 'NOT_FOUND', 404);
  }

  const existing = await prisma.contactTag.findUnique({
    where: {
      contactId_tagId: { contactId, tagId },
    },
  });

  if (!existing) {
    throw new AppError('Contact tag not found', 'NOT_FOUND', 404);
  }

  await prisma.contactTag.delete({
    where: {
      contactId_tagId: { contactId, tagId },
    },
  });

  return { success: true };
}

export interface TimelineEntry {
  type: 'conversation' | 'case' | 'case_event' | 'tag';
  timestamp: string;
  data: Record<string, unknown>;
}

export async function getContactTimeline(
  prisma: PrismaClient,
  contactId: string,
  tenantId: string,
) {
  // Verify contact exists
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
  });
  if (!contact) {
    throw new AppError('Contact not found', 'NOT_FOUND', 404);
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
  prisma: PrismaClient,
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

  if (!primary) throw new AppError('Primary contact not found', 'NOT_FOUND', 404);
  if (!secondary) throw new AppError('Secondary contact not found', 'NOT_FOUND', 404);
  if (secondary.isArchived) throw new AppError('Secondary contact is already archived/merged', 'BAD_REQUEST', 400);

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
  prisma: PrismaClient,
  io: SocketIOServer,
  tenantId: string,
  primaryContactId: string,
  secondaryContactId: string,
) {
  return prisma.$transaction(async (tx) => {
    // 1. Validate both contacts exist, same tenant, secondary not archived
    const [primary, secondary] = await Promise.all([
      tx.contact.findFirst({ where: { id: primaryContactId, tenantId } }),
      tx.contact.findFirst({ where: { id: secondaryContactId, tenantId } }),
    ]);

    if (!primary) throw new AppError('Primary contact not found', 'NOT_FOUND', 404);
    if (!secondary) throw new AppError('Secondary contact not found', 'NOT_FOUND', 404);
    if (secondary.isArchived) throw new AppError('Secondary contact is already archived/merged', 'BAD_REQUEST', 400);
    if (primaryContactId === secondaryContactId) throw new AppError('Cannot merge a contact with itself', 'BAD_REQUEST', 400);

    // 2. Move channel identities
    await tx.channelIdentity.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 3. Move conversations
    await tx.conversation.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 4. Move cases
    await tx.case.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 5. Merge tags (skip duplicates)
    const secondaryTags = await tx.contactTag.findMany({
      where: { contactId: secondaryContactId },
    });
    const primaryTagIds = await tx.contactTag.findMany({
      where: { contactId: primaryContactId },
      select: { tagId: true },
    });
    const existingTagIds = new Set(primaryTagIds.map((t) => t.tagId));
    for (const st of secondaryTags) {
      if (!existingTagIds.has(st.tagId)) {
        await tx.contactTag.create({
          data: {
            contactId: primaryContactId,
            tagId: st.tagId,
            addedBy: st.addedBy,
            addedById: st.addedById,
          },
        });
      }
    }
    // Remove secondary's tags to avoid FK issues
    await tx.contactTag.deleteMany({
      where: { contactId: secondaryContactId },
    });

    // 6. Merge attributes (skip duplicate keys)
    const secondaryAttrs = await tx.contactAttribute.findMany({
      where: { contactId: secondaryContactId },
    });
    const primaryAttrKeys = await tx.contactAttribute.findMany({
      where: { contactId: primaryContactId },
      select: { key: true },
    });
    const existingKeys = new Set(primaryAttrKeys.map((a) => a.key));
    for (const sa of secondaryAttrs) {
      if (!existingKeys.has(sa.key)) {
        await tx.contactAttribute.create({
          data: {
            contactId: primaryContactId,
            key: sa.key,
            value: sa.value,
            dataType: sa.dataType,
          },
        });
      }
    }
    await tx.contactAttribute.deleteMany({
      where: { contactId: secondaryContactId },
    });

    // 7. Merge contact relations
    const relationsFrom = await tx.contactRelation.findMany({
      where: { fromContactId: secondaryContactId },
    });
    for (const rel of relationsFrom) {
      const targetId = rel.toContactId === secondaryContactId ? primaryContactId : rel.toContactId;
      if (targetId === primaryContactId && rel.fromContactId === secondaryContactId) {
        // Would create self-reference or duplicate, skip
        const existing = await tx.contactRelation.findFirst({
          where: { fromContactId: primaryContactId, toContactId: targetId, relationType: rel.relationType },
        });
        if (!existing && primaryContactId !== targetId) {
          await tx.contactRelation.update({
            where: { id: rel.id },
            data: { fromContactId: primaryContactId },
          });
        }
      }
    }
    const relationsTo = await tx.contactRelation.findMany({
      where: { toContactId: secondaryContactId },
    });
    for (const rel of relationsTo) {
      if (rel.fromContactId === primaryContactId) continue; // Would become self-reference
      const existing = await tx.contactRelation.findFirst({
        where: { fromContactId: rel.fromContactId, toContactId: primaryContactId, relationType: rel.relationType },
      });
      if (!existing) {
        await tx.contactRelation.update({
          where: { id: rel.id },
          data: { toContactId: primaryContactId },
        });
      }
    }
    // Clean up any remaining relations pointing to secondary
    await tx.contactRelation.deleteMany({
      where: {
        OR: [
          { fromContactId: secondaryContactId },
          { toContactId: secondaryContactId },
        ],
      },
    });

    // 8. Archive the secondary contact
    await tx.contact.update({
      where: { id: secondaryContactId },
      data: {
        isArchived: true,
        mergedIntoId: primaryContactId,
      },
    });

    // 9. Emit WebSocket event
    io.to(`tenant:${tenantId}`).emit('contact.merged', {
      primaryContactId,
      secondaryContactId,
      primaryName: primary.displayName,
      secondaryName: secondary.displayName,
    });

    return {
      primaryContactId,
      secondaryContactId,
      primaryName: primary.displayName,
      secondaryName: secondary.displayName,
    };
  });
}
