import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { logger } from '@open333crm/core';
import { decryptCredentials } from '../channel/channel.service.js';
import {
  renderTemplateBody,
  extractVariables,
  buildVariableMap,
  type TemplateVariable,
} from './template-renderer.js';
import { resolveContext } from './template-context.js';

// --- Template CRUD ---

export async function listTemplates(
  prisma: TenantDb,
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

// --- Broadcast CRUD ---

export async function listBroadcasts(
  prisma: TenantDb,
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
      include: {
        material: { select: { id: true, name: true, channelType: true, contentType: true } },
      },
    }),
    prisma.broadcast.count({ where: where as any }),
  ]);

  return { broadcasts, total, page, limit };
}

export async function getBroadcast(prisma: TenantDb, id: string, tenantId: string) {
  const broadcast = await prisma.broadcast.findFirst({
    where: { id, tenantId },
    include: {
      material: { select: { id: true, name: true, channelType: true, contentType: true } },
    },
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
  prisma: TenantDb,
  tenantId: string,
  agentId: string,
  data: {
    name: string;
    materialId?: string;
    templateId?: string;
    channelId: string;
    campaignId?: string;
    segmentId?: string;
    targetType: 'all' | 'segment' | 'tags' | 'contacts';
    targetConfig?: { tagIds?: string[]; contactIds?: string[] };
    scheduledAt?: string;
  },
) {
  if (Boolean(data.materialId) === Boolean(data.templateId)) {
    throw new AppError('Must provide exactly one of materialId or templateId', 'INVALID_INPUT', 400);
  }

  // 驗證來源（Material 或舊 Template）
  if (data.materialId) {
    const material = await prisma.material.findFirst({
      where: { id: data.materialId, tenantId, isActive: true },
    });
    if (!material) {
      throw new AppError('Material not found', 'NOT_FOUND', 404);
    }
  } else {
    const template = await prisma.messageTemplate.findFirst({
      where: {
        id: data.templateId!,
        OR: [{ tenantId }, { tenantId: null, isSystem: true }],
      },
    });
    if (!template) {
      throw new AppError('Template not found', 'NOT_FOUND', 404);
    }
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
      materialId: data.materialId || null,
      templateId: data.templateId || null,
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

export async function cancelBroadcast(prisma: TenantDb, id: string, tenantId: string) {
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
  prisma: TenantDb,
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
    if (!broadcast.channelId || !broadcast.tenantId || !broadcast.createdById) {
      throw new AppError('Broadcast data is incomplete', 'INVALID_STATE', 400);
    }
    if (!broadcast.materialId && !broadcast.templateId) {
      throw new AppError('Broadcast has no content source', 'INVALID_STATE', 400);
    }

    // 取得內容來源：優先 Material，舊資料 fallback Template
    let contentType: string;
    let body: Record<string, unknown>;
    let sourceVars: TemplateVariable[];

    if (broadcast.materialId) {
      const material = await prisma.material.findFirst({
        where: { id: broadcast.materialId, tenantId: broadcast.tenantId },
      });
      if (!material) {
        throw new AppError('Material not found', 'NOT_FOUND', 404);
      }
      contentType = material.contentType;
      body = material.body as Record<string, unknown>;
      sourceVars = (material.variables || []) as unknown as TemplateVariable[];
    } else {
      const template = await prisma.messageTemplate.findFirst({
        where: {
          id: broadcast.templateId!,
          OR: [
            { tenantId: broadcast.tenantId },
            { tenantId: null, isSystem: true },
          ],
        },
      });
      if (!template) {
        throw new AppError('Template not found', 'NOT_FOUND', 404);
      }
      contentType = template.contentType;
      body = template.body as Record<string, unknown>;
      sourceVars = (template.variables || []) as unknown as TemplateVariable[];
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

    // ── 0 受眾 early return：避免 failedCount===length===0 落入 status=failed ──
    if (identities.length === 0) {
      await prisma.broadcast.update({
        where: { id: broadcastId },
        data: { status: 'completed', successCount: 0, failedCount: 0 },
      });
      return { total: 0, success: 0, failed: 0 };
    }

    const extractedKeys = extractVariables(body);
    const needsPersonalization = extractedKeys.length > 0;

    let successCount = 0;
    let failedCount = 0;
    const now = new Date();

    // ── LINE multicast 路徑：無需 per-recipient 個人化 ──
    // 條件：LINE 渠道 + 訊息內無變數
    // multicast 一次發給多人，全員看到完全相同的訊息（FB 無此 API）。
    // service 層自己 chunk 為 499/批（LINE 官方限 500，留 1 個 buffer）。
    // 每批單獨呼叫 plugin → 失敗只影響該批的 recipient 標 failed，前面批已成功不誤標。
    // 個人化分支仍走 for loop push（每人 body 不同）。
    if (channel.channelType === 'LINE' && !needsPersonalization) {
      const MULTICAST_CHUNK = 499;
      for (let i = 0; i < identities.length; i += MULTICAST_CHUNK) {
        const chunk = identities.slice(i, i + MULTICAST_CHUNK);
        const uids = chunk.map((c) => c.uid);
        const outbound = {
          contentType,
          content: { ...body, strategy: 'multicast', recipientUids: uids },
        };

        let chunkDelivered = false;
        try {
          const result = await plugin.sendMessage(uids[0], outbound, credentials);
          chunkDelivered = result.success;
          if (result.success) {
            successCount += chunk.length;
          } else {
            failedCount += chunk.length;
          }
        } catch (err) {
          logger.error(`[broadcast:${broadcastId}] multicast chunk send failed (chunk ${i / MULTICAST_CHUNK + 1})`, { err });
          failedCount += chunk.length;
        }

        // 該批 recipient 記錄
        try {
          await prisma.broadcastRecipient.createMany({
            data: chunk.map((identity) => ({
              broadcastId,
              contactId: identity.contactId,
              deliveryStatus: chunkDelivered ? 'sent' : 'failed',
              sentAt: now,
            })),
            skipDuplicates: true,
          });
        } catch (err) {
          logger.warn(`[broadcast:${broadcastId}] recipient batch write failed (chunk ${i / MULTICAST_CHUNK + 1})`, { err });
        }
      }
    } else {
      // ── per-recipient for loop（個人化 / FB / 其他渠道）──
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
            const vars = buildVariableMap(sourceVars, ctx);
            personalizedBody = renderTemplateBody(body, vars);
          }

          const outbound = {
            contentType,
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
    }

    // 累計使用次數
    if (broadcast.materialId) {
      await prisma.material.update({
        where: { id: broadcast.materialId },
        data: { usageCount: { increment: 1 }, lastUsedAt: now },
      });
    } else if (broadcast.templateId) {
      await prisma.messageTemplate.update({
        where: { id: broadcast.templateId },
        data: { usageCount: { increment: 1 } },
      });
    }

    // Final status
    // failed：全員失敗（含 0 受眾的 case 已在前面 early return，此處 identities.length 必 > 0）
    // completed：至少 1 人成功（含部分失敗）
    const finalStatus = failedCount > 0 && failedCount === identities.length ? 'failed' : 'completed';
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
  prisma: TenantDb,
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

