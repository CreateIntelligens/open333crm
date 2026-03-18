import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';
import { getChannelPlugin } from '../../channels/registry.js';
import { decryptCredentials } from '../channel/channel.service.js';

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

// --- Broadcast ---

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
  // 1. Get template
  const template = await prisma.messageTemplate.findFirst({
    where: {
      id: data.templateId,
      OR: [{ tenantId }, { tenantId: null, isSystem: true }],
    },
  });

  if (!template) {
    throw new AppError('Template not found', 'NOT_FOUND', 404);
  }

  // 2. Get channel + plugin + credentials
  const channel = await prisma.channel.findFirst({
    where: { id: data.channelId, tenantId, isActive: true },
  });

  if (!channel) {
    throw new AppError('Channel not found or inactive', 'NOT_FOUND', 404);
  }

  const plugin = getChannelPlugin(channel.channelType);
  if (!plugin) {
    throw new AppError(`No plugin for channel type: ${channel.channelType}`, 'UNSUPPORTED_CHANNEL', 400);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);

  // 3. Find target contacts with their channel identities
  const identityWhere: Record<string, unknown> = {
    channelId: data.channelId,
    contact: { tenantId },
  };

  if (data.targetType === 'tags' && data.tagIds?.length) {
    identityWhere.contact = {
      tenantId,
      tags: { some: { tagId: { in: data.tagIds } } },
    };
  } else if (data.targetType === 'contacts' && data.contactIds?.length) {
    identityWhere.contactId = { in: data.contactIds };
    identityWhere.contact = { tenantId };
  }

  const identities = await prisma.channelIdentity.findMany({
    where: identityWhere as any,
    select: {
      uid: true,
      contactId: true,
      contact: { select: { id: true, displayName: true } },
    },
  });

  if (identities.length === 0) {
    throw new AppError('No contacts found for the selected audience', 'NO_TARGETS', 400);
  }

  // 4. Send messages
  const body = template.body as Record<string, unknown>;
  const outbound = {
    contentType: template.contentType,
    content: body,
  };

  let successCount = 0;
  let failedCount = 0;

  for (const identity of identities) {
    try {
      const result = await plugin.sendMessage(identity.uid, outbound, credentials);
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  // 5. Update usage count
  await prisma.messageTemplate.update({
    where: { id: template.id },
    data: { usageCount: { increment: 1 } },
  });

  const stats = {
    total: identities.length,
    success: successCount,
    failed: failedCount,
  };

  return stats;
}
