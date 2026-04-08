import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import {
  renderTemplateBody,
  extractVariables,
  validateVariables,
  buildVariableMap,
  sampleVariables,
  type TemplateVariable,
} from './template-renderer.js';
import { resolveContext, STATIC_VARIABLE_METADATA, type VariableCategory } from './template-context.js';

// --- Template CRUD ---

export async function listTemplates(
  prisma: PrismaClient,
  tenantId: string,
  filters: {
    category?: string;
    channelType?: string;
    q?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const { category, channelType, q, page = 1, limit = 50 } = filters;

  const where: Record<string, unknown> = {
    OR: [{ tenantId }, { tenantId: null, isSystem: true }],
  };
  if (category) where.category = category;
  if (channelType) where.channelType = channelType;
  if (q) {
    where.AND = [
      {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }

  const [templates, total] = await Promise.all([
    prisma.messageTemplate.findMany({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.messageTemplate.count({ where: where as any }),
  ]);

  return { templates, total, page, limit };
}

export async function getTemplate(prisma: PrismaClient, id: string, tenantId: string) {
  const template = await prisma.messageTemplate.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
    },
  });

  if (!template) {
    throw new AppError('Template not found', 'NOT_FOUND', 404);
  }

  return template;
}

export async function createTemplate(
  prisma: PrismaClient,
  tenantId: string,
  data: {
    name: string;
    description?: string;
    category?: string;
    channelType?: string;
    contentType?: string;
    body: Record<string, unknown>;
    variables?: unknown[];
  },
) {
  const template = await prisma.messageTemplate.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description || null,
      category: data.category || '一般',
      channelType: data.channelType || 'universal',
      contentType: data.contentType || 'text',
      body: data.body as any,
      variables: (data.variables || []) as any,
    },
  });

  return template;
}

export async function updateTemplate(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    name?: string;
    description?: string;
    category?: string;
    channelType?: string;
    contentType?: string;
    body?: Record<string, unknown>;
    variables?: unknown[];
    isActive?: boolean;
  },
) {
  const template = await prisma.messageTemplate.findFirst({
    where: { id, tenantId },
  });

  if (!template) {
    throw new AppError('Template not found', 'NOT_FOUND', 404);
  }

  if (template.isSystem) {
    throw new AppError('Cannot modify system templates', 'FORBIDDEN', 403);
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.channelType !== undefined) updateData.channelType = data.channelType;
  if (data.contentType !== undefined) updateData.contentType = data.contentType;
  if (data.body !== undefined) updateData.body = data.body;
  if (data.variables !== undefined) updateData.variables = data.variables;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  const updated = await prisma.messageTemplate.update({
    where: { id },
    data: updateData,
  });

  return updated;
}

export async function deleteTemplate(prisma: PrismaClient, id: string, tenantId: string) {
  const template = await prisma.messageTemplate.findFirst({
    where: { id, tenantId },
  });

  if (!template) {
    throw new AppError('Template not found', 'NOT_FOUND', 404);
  }

  if (template.isSystem) {
    throw new AppError('Cannot delete system templates', 'FORBIDDEN', 403);
  }

  await prisma.messageTemplate.delete({ where: { id } });

  return { deleted: true };
}

// --- Template Categories ---

export async function listTemplateCategories(prisma: PrismaClient, tenantId: string) {
  const rows = await prisma.messageTemplate.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
      isActive: true,
    },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });

  return rows.map((r) => r.category);
}

export async function getAvailableVariables(
  prisma: PrismaClient,
  tenantId: string,
): Promise<VariableCategory[]> {
  // Query distinct attribute keys used by this tenant's contacts
  const attrRows = await prisma.contactAttribute.findMany({
    where: { contact: { tenantId } },
    select: { key: true },
    distinct: ['key'],
    orderBy: { key: 'asc' },
  });

  const categories: VariableCategory[] = [...STATIC_VARIABLE_METADATA];

  if (attrRows.length > 0) {
    categories.push({
      category: '自訂屬性',
      variables: attrRows.map((r) => ({
        key: `attribute.${r.key}`,
        label: r.key,
        example: '',
      })),
    });
  }

  return categories;
}

// --- Template Preview & Render ---

export async function previewTemplate(
  prisma: PrismaClient,
  templateId: string,
  tenantId: string,
  opts: {
    contactId?: string;
    conversationId?: string;
    variables?: Record<string, string>;
    useSampleData?: boolean;
  },
) {
  const template = await getTemplate(prisma, templateId, tenantId);
  const body = template.body as Record<string, unknown>;
  const templateVars = (template.variables || []) as unknown as TemplateVariable[];

  // Build variables map
  let vars: Record<string, string> = {};

  if (opts.contactId || opts.conversationId) {
    const ctx = await resolveContext(prisma, {
      contactId: opts.contactId,
      conversationId: opts.conversationId,
      tenantId,
    });
    vars = { ...vars, ...ctx };
  }

  if (opts.useSampleData) {
    const keys = extractVariables(body);
    const samples = sampleVariables(keys);
    // Sample data fills in anything not already resolved from DB
    vars = { ...samples, ...vars };
  }

  if (opts.variables) {
    vars = { ...vars, ...opts.variables };
  }

  // Apply defaults from template variable definitions
  vars = buildVariableMap(templateVars, vars);

  const rendered = renderTemplateBody(body, vars);

  return {
    original: body,
    rendered,
    variables: vars,
    extractedKeys: extractVariables(body),
  };
}

export async function renderAndSendTemplate(
  prisma: PrismaClient,
  io: SocketIOServer,
  templateId: string,
  tenantId: string,
  agentId: string,
  opts: {
    conversationId: string;
    variables?: Record<string, string>;
  },
) {
  const template = await getTemplate(prisma, templateId, tenantId);
  const body = template.body as Record<string, unknown>;
  const templateVars = (template.variables || []) as unknown as TemplateVariable[];

  // Resolve context from conversation
  const conv = await prisma.conversation.findUnique({
    where: { id: opts.conversationId },
    include: {
      channel: true,
      contact: { include: { channelIdentities: true } },
    },
  });
  if (!conv) {
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  // Build variables
  const ctx = await resolveContext(prisma, {
    contactId: conv.contactId,
    conversationId: opts.conversationId,
    tenantId,
  });
  let vars = buildVariableMap(templateVars, { ...ctx, ...(opts.variables || {}) });

  // Validate required variables
  const missing = validateVariables(templateVars, vars);
  if (missing.length > 0) {
    throw new AppError(
      `Missing required variables: ${missing.join(', ')}`,
      'VALIDATION_ERROR',
      400,
    );
  }

  const rendered = renderTemplateBody(body, vars);
  const renderedText = typeof rendered === 'object' && rendered !== null
    ? (rendered as Record<string, unknown>).text as string || JSON.stringify(rendered)
    : String(rendered);

  // Create Message record
  const now = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId: opts.conversationId,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      senderId: agentId,
      contentType: template.contentType,
      content: rendered as any,
      metadata: { templateId: template.id, templateName: template.name },
      isRead: true,
      createdAt: now,
    },
    include: {
      sender: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Update conversation
  await prisma.conversation.update({
    where: { id: opts.conversationId },
    data: { lastMessageAt: now },
  });

  // Deliver to channel
  if (conv.channel?.isActive) {
    const identity = conv.contact?.channelIdentities?.find(
      (ci) => ci.channelId === conv.channelId,
    );
    if (identity) {
      const plugin = getChannelPlugin(conv.channel.channelType);
      if (plugin) {
        try {
          const credentials = decryptCredentials(conv.channel.credentialsEncrypted);
          await plugin.sendMessage(
            identity.uid,
            { contentType: template.contentType, content: rendered },
            credentials,
          );
        } catch (err) {
          console.error('[renderAndSendTemplate] Channel delivery failed:', err);
        }
      }
    }
  }

  // Update template usage
  await prisma.messageTemplate.update({
    where: { id: template.id },
    data: { usageCount: { increment: 1 } },
  });

  // Emit WebSocket events
  io.to(`conversation:${opts.conversationId}`).emit('message.new', {
    conversationId: opts.conversationId,
    message,
  });

  return { message, rendered };
}

// --- Broadcast CRUD ---

export async function listBroadcasts(
  prisma: PrismaClient,
  tenantId: string,
  filters: { campaignId?: string; status?: string; page?: number; limit?: number } = {},
) {
  const { campaignId, status, page = 1, limit = 50 } = filters;
  const where: Record<string, unknown> = { tenantId };
  if (campaignId) where.campaignId = campaignId;
  if (status) where.status = status;

  const [broadcasts, total] = await Promise.all([
    prisma.broadcast.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.broadcast.count({ where: where as any }),
  ]);

  return { broadcasts, total, page, limit };
}

export async function getBroadcast(prisma: PrismaClient, id: string, tenantId: string) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id, tenantId },
  });
  if (!broadcast) {
    throw new AppError('Broadcast not found', 'NOT_FOUND', 404);
  }

  // Add recipient-level metrics
  const [replied, casesOpened] = await Promise.all([
    prisma.broadcastRecipient.count({
      where: { broadcastId: id, replied: true },
    }),
    prisma.broadcastRecipient.count({
      where: { broadcastId: id, caseId: { not: null } },
    }),
  ]);

  return {
    ...broadcast,
    replied,
    casesOpened,
    replyRate: broadcast.successCount > 0 ? Math.round((replied / broadcast.successCount) * 100) : 0,
  };
}

export async function createBroadcast(
  prisma: PrismaClient,
  tenantId: string,
  agentId: string,
  data: {
    name: string;
    templateId: string;
    channelId: string;
    campaignId?: string;
    segmentId?: string;
    targetType: 'all' | 'segment' | 'tags' | 'contacts';
    targetConfig?: { tagIds?: string[]; contactIds?: string[] };
    scheduledAt?: string;
  },
) {
  // Validate template exists
  const template = await prisma.messageTemplate.findFirst({
    where: {
      id: data.templateId,
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
    },
  });
  if (!template) {
    throw new AppError('Template not found', 'NOT_FOUND', 404);
  }

  // Validate channel exists
  const channel = await prisma.channel.findFirst({
    where: { id: data.channelId, tenantId, isActive: true },
  });
  if (!channel) {
    throw new AppError('Channel not found or inactive', 'NOT_FOUND', 404);
  }

  // Validate campaign if provided
  if (data.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: data.campaignId, tenantId },
    });
    if (!campaign) {
      throw new AppError('Campaign not found', 'NOT_FOUND', 404);
    }
  }

  // Validate segment if provided
  if (data.segmentId) {
    const segment = await prisma.segment.findFirst({
      where: { id: data.segmentId, tenantId },
    });
    if (!segment) {
      throw new AppError('Segment not found', 'NOT_FOUND', 404);
    }
  }

  const status = data.scheduledAt ? 'scheduled' : 'draft';

  const broadcast = await prisma.broadcast.create({
    data: {
      tenantId,
      name: data.name,
      templateId: data.templateId,
      channelId: data.channelId,
      campaignId: data.campaignId || null,
      segmentId: data.segmentId || null,
      targetType: data.targetType,
      targetConfig: (data.targetConfig || {}) as any,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      status,
      createdById: agentId,
    },
  });

  return broadcast;
}

export async function cancelBroadcast(prisma: PrismaClient, id: string, tenantId: string) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id, tenantId },
  });
  if (!broadcast) {
    throw new AppError('Broadcast not found', 'NOT_FOUND', 404);
  }
  if (!['draft', 'scheduled'].includes(broadcast.status)) {
    throw new AppError('Can only cancel draft or scheduled broadcasts', 'INVALID_STATUS', 400);
  }

  const updated = await prisma.broadcast.update({
    where: { id },
    data: { status: 'cancelled' },
  });
  return updated;
}

/**
 * Execute a broadcast: resolve audience, send personalized messages, update stats.
 */
export async function executeBroadcast(
  prisma: PrismaClient,
  io: SocketIOServer,
  broadcastId: string,
) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId },
  });
  if (!broadcast) {
    throw new AppError('Broadcast not found', 'NOT_FOUND', 404);
  }
  if (!['draft', 'scheduled'].includes(broadcast.status)) {
    throw new AppError('Broadcast is not in a sendable state', 'INVALID_STATUS', 400);
  }

  // Mark as sending
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'sending', sentAt: new Date() },
  });

  try {
    if (!broadcast.templateId || !broadcast.channelId || !broadcast.tenantId || !broadcast.createdById) {
      throw new AppError('Broadcast data is incomplete', 'INVALID_STATE', 400);
    }

    // Get template
    const template = await prisma.messageTemplate.findFirst({
      where: {
        id: broadcast.templateId,
        OR: [
          { tenantId: broadcast.tenantId },
          { tenantId: null, isSystem: true },
        ],
      },
    });
    if (!template) {
      throw new AppError('Template not found', 'NOT_FOUND', 404);
    }

    // Get channel + plugin
    const channel = await prisma.channel.findFirst({
      where: { id: broadcast.channelId, tenantId: broadcast.tenantId, isActive: true },
    });
    if (!channel) {
      throw new AppError('Channel not found or inactive', 'NOT_FOUND', 404);
    }

    const plugin = getChannelPlugin(channel.channelType);
    if (!plugin) {
      throw new AppError(`No plugin for channel type: ${channel.channelType}`, 'UNSUPPORTED_CHANNEL', 400);
    }
    const credentials = decryptCredentials(channel.credentialsEncrypted);

    // Resolve audience
    const identities = await resolveAudience(prisma, broadcast);

    // Update total count
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { totalCount: identities.length },
    });

    // Check if template has variables that need personalization
    const body = template.body as Record<string, unknown>;
    const templateVars = (template.variables || []) as unknown as TemplateVariable[];
    const extractedKeys = extractVariables(body);
    const needsPersonalization = extractedKeys.length > 0;

    let successCount = 0;
    let failedCount = 0;
    const now = new Date();

    for (const identity of identities) {
      let delivered = false;
      try {
        // Per-recipient personalization
        let personalizedBody = body;
        if (needsPersonalization) {
          const ctx = await resolveContext(prisma, {
            contactId: identity.contactId,
            tenantId: broadcast.tenantId,
          });
          const vars = buildVariableMap(templateVars, ctx);
          personalizedBody = renderTemplateBody(body, vars);
        }

        const outbound = {
          contentType: template.contentType,
          content: personalizedBody,
        };

        const result = await plugin.sendMessage(identity.uid, outbound, credentials);
        if (result.success) {
          successCount++;
          delivered = true;
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }

      // Create recipient record for tracking replies & cases
      try {
        await prisma.broadcastRecipient.create({
          data: {
            broadcastId,
            contactId: identity.contactId,
            deliveryStatus: delivered ? 'sent' : 'failed',
            sentAt: now,
          },
        });
      } catch {
        // Ignore duplicate (unique constraint on broadcastId+contactId)
      }
    }

    // Update template usage
    await prisma.messageTemplate.update({
      where: { id: template.id },
      data: { usageCount: { increment: 1 } },
    });

    // Final status
    const finalStatus = failedCount === identities.length ? 'failed' : 'completed';
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: finalStatus, successCount, failedCount },
    });

    return { total: identities.length, success: successCount, failed: failedCount };
  } catch (err) {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'failed' },
    });
    throw err;
  }
}

/**
 * Resolve audience for a broadcast based on targetType.
 */
async function resolveAudience(
  prisma: PrismaClient,
  broadcast: {
    tenantId: string;
    channelId: string;
    targetType: string;
    segmentId: string | null;
    targetConfig: unknown;
  },
) {
  const config = (broadcast.targetConfig || {}) as { tagIds?: string[]; contactIds?: string[] };

  const identityWhere: Record<string, unknown> = {
    channelId: broadcast.channelId,
    contact: { tenantId: broadcast.tenantId, isArchived: false },
  };

  if (broadcast.targetType === 'segment' && broadcast.segmentId) {
    // Use segment rules to find contacts
    const segment = await prisma.segment.findFirst({
      where: { id: broadcast.segmentId },
    });
    if (segment) {
      const { calculateSegmentContacts } = await import('./segment.service.js');
      const { contactIds } = await calculateSegmentContacts(
        prisma,
        broadcast.tenantId,
        segment.rules as any,
      );
      if (contactIds.length > 0) {
        identityWhere.contactId = { in: contactIds };
      } else {
        return [];
      }
    }
  } else if (broadcast.targetType === 'tags' && config.tagIds?.length) {
    identityWhere.contact = {
      tenantId: broadcast.tenantId,
      isArchived: false,
      tags: { some: { tagId: { in: config.tagIds } } },
    };
  } else if (broadcast.targetType === 'contacts' && config.contactIds?.length) {
    identityWhere.contactId = { in: config.contactIds };
  }

  const identities = await prisma.channelIdentity.findMany({
    where: identityWhere,
    select: {
      uid: true,
      contactId: true,
    },
  });

  return identities;
}

// --- Legacy broadcast endpoint (backward compat) ---

export async function broadcastMessage(
  prisma: PrismaClient,
  io: SocketIOServer,
  tenantId: string,
  agentId: string,
  data: {
    templateId: string;
    channelId: string;
    targetType: 'all' | 'tags' | 'contacts';
    tagIds?: string[];
    contactIds?: string[];
  },
) {
  // Create a broadcast record, then execute immediately
  const broadcast = await createBroadcast(prisma, tenantId, agentId, {
    name: `Quick broadcast ${new Date().toISOString().slice(0, 16)}`,
    templateId: data.templateId,
    channelId: data.channelId,
    targetType: data.targetType,
    targetConfig: { tagIds: data.tagIds, contactIds: data.contactIds },
  });

  const result = await executeBroadcast(prisma, io, broadcast.id);
  return result;
}
