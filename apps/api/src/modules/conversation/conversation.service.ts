import type { PrismaClient } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { channelIdWhereFilter, type AccessibleChannels } from '../../services/channel-visibility.js';
import type { Server as SocketIOServer } from 'socket.io';
import type { Prisma } from '@prisma/client';
import IORedis from 'ioredis';
import { AppError } from '../../shared/utils/response.js';
import { getChannelPlugin, LINE_DELIVERY_METADATA_KEYS } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import { eventBus } from '../../events/event-bus.js';
import { getConfig } from '../../config/env.js';
import { logger } from '@open333crm/core';
import { CHANNEL_TYPE, selectSafeLineStrategy, type ConversationUpdatedPayload } from '@open333crm/shared';
import { notFound } from '../../shared/messages/resource.js';
import { markCaseFirstResponse } from '../case/case.service.js';
import { prepareStoredMessageContent } from '../ai/deidentification.service.js';

export interface ConversationFilters {
  status?: string;
  channelType?: string;
  assigneeId?: string;
  unread?: boolean;
  closedAfter?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface ChannelDeliveryOptions {
  strategy?: 'reply' | 'push';
  replyToken?: string;
  receivedAt?: string;
}

export function mergeLineDeliveryMetadata(
  currentMetadata: unknown,
  retryKey: string,
  result: { success: boolean; requestId?: string },
): Record<string, unknown> {
  const base = currentMetadata && typeof currentMetadata === 'object' && !Array.isArray(currentMetadata)
    ? currentMetadata as Record<string, unknown>
    : {};
  return {
    ...base,
    [LINE_DELIVERY_METADATA_KEYS.retryKey]: retryKey,
    [LINE_DELIVERY_METADATA_KEYS.status]: result.success ? 'accepted' : 'failed',
    ...(result.requestId ? { [LINE_DELIVERY_METADATA_KEYS.requestId]: result.requestId } : {}),
  };
}

export async function listConversations(
  prisma: TenantDb,
  tenantId: string,
  filters: ConversationFilters,
  pagination: PaginationParams,
  /** CM-173 渠道級可見性：ALL_CHANNELS→不過濾；Set→只回可見渠道（空集合＝fail-closed 回空）。 */
  /** 必填：呼叫端明確決定可見範圍，不受限時傳 ALL_CHANNELS（漏傳會編譯失敗，而不是悄悄不過濾） */
  accessibleChannels: AccessibleChannels,
) {
  const where: Prisma.ConversationWhereInput = {
    tenantId,
  };

  // 渠道可見性過濾（總店 ALL 時 filter 為 undefined、不加條件）
  const filter = channelIdWhereFilter(accessibleChannels);
  if (filter) where.channelId = filter;

  if (filters.status) {
    if (filters.status === '!CLOSED') {
      // Special value: everything except CLOSED
      where.status = { not: 'CLOSED' as any };
    } else if (filters.status.includes(',')) {
      // Comma-separated multi-status: use Prisma enum `in`
      const statuses = filters.status.split(',').map(s => s.trim()).filter(Boolean);
      where.status = { in: statuses } as any;
    } else {
      where.status = filters.status as any;
    }
  }
  if (filters.channelType) {
    if (filters.channelType.includes(',')) {
      const channels = filters.channelType.split(',').map(s => s.trim()).filter(Boolean);
      where.channelType = { in: channels } as any;
    } else {
      where.channelType = filters.channelType as any;
    }
  }
  if (filters.assigneeId) {
    if (filters.assigneeId === 'unassigned') {
      where.assignedToId = null;
    } else {
      where.assignedToId = filters.assigneeId;
    }
  }
  if (filters.unread) {
    where.unreadCount = { gt: 0 };
  }
  if (filters.closedAfter) {
    where.updatedAt = { gte: new Date(filters.closedAfter) };
  }

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        contact: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            phone: true,
            email: true,
          },
        },
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
            avatarUrl: true,
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
            // 列表要能標出「最後一則沒送出去」，否則客服掃列表時完全看不到失敗
            // （送出失敗的紀錄靠 metadata.deliveryFailed 辨識）
            metadata: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.conversation.count({ where }),
  ]);

  // Flatten lastMessage from the messages array
  const result = conversations.map((conv) => {
    const { messages, ...rest } = conv;
    return {
      ...rest,
      lastMessage: messages[0] ?? null,
    };
  });

  return { conversations: result, total };
}

export async function getConversation(
  prisma: TenantDb,
  id: string,
  tenantId: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
    include: {
      contact: {
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
      },
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
          avatarUrl: true,
          role: true,
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
      case: {
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
        },
      },
    },
  });

  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }

  return conversation;
}

export async function markConversationRead(
  prisma: TenantDb,
  io: SocketIOServer,
  id: string,
  tenantId: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });

  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: { unreadCount: 0 },
  });

  const wsPayload: ConversationUpdatedPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  };

  io.to(`conversation:${id}`).emit('conversation.updated', wsPayload);
  io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

  return updated;
}

export async function getMessages(
  prisma: TenantDb,
  conversationId: string,
  page: number,
  limit: number,
  order: 'asc' | 'desc' = 'asc',
) {
  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: order },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    }),
    prisma.message.count({ where: { conversationId } }),
  ]);

  return { messages, total };
}

export async function sendMessage(
  prisma: TenantDb,
  io: SocketIOServer,
  conversationId: string,
  agentId: string,
  tenantId: string,
  data: { contentType: string; content: Record<string, unknown>; privacyMode?: 'mask' | 'original' },
) {
  // Verify conversation exists and belongs to tenant
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }

  const now = new Date();
  const sequence = await prisma.message.count({
    where: { conversationId },
  }) + 1;
  const stored = data.contentType === 'text'
    ? await prepareStoredMessageContent(
        prisma,
        tenantId,
        data.content,
        data.privacyMode === 'original' ? 'agent_original' : 'agent_default',
      )
    : { content: data.content as Prisma.InputJsonObject, metadata: {} };

  const message = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      senderId: agentId,
      contentType: data.contentType,
      content: stored.content as any,
      metadata: stored.metadata as any,
      sequence,
      isRead: true,
      createdAt: now,
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
  });

  // Update conversation
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      unreadCount: 0,
    },
  });

  // 對話關聯工單時，客服的第一則訊息即為首次回應（SLA 首次回應判斷依此欄位）。
  // 記錄失敗不可擋住訊息送達：訊息已寫入，接下來還要推播與送到渠道
  if (conversation.caseId) {
    await markCaseFirstResponse(prisma, tenantId, conversation.caseId, now).catch((err: unknown) =>
      logger.error('[Case] 記錄首次回應時間失敗', {
        caseId: conversation.caseId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // Emit WebSocket event
  const wsPayload = {
    conversationId,
    message: {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      senderId: message.senderId,
      contentType: message.contentType,
      content: message.content as Record<string, unknown>,
      type: message.contentType,
      payload: message.content as Record<string, unknown>,
      createdAt: message.createdAt.toISOString(),
      sequence: message.sequence,
      sender: (message as any).sender,
    },
  };

  io.to(`conversation:${conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

  // --- Channel Delivery: route outbound message through channel plugin ---
  let delivery: { success: boolean; requestId?: string; error?: string } | null = null;
  // 送不出去的原因（S08）：寫進訊息 metadata.deliveryFailed／deliveryError，後台才看得到，
  // 與自動化送出失敗（workers channel-delivery）同一組欄位，MessageBubble 依此顯示紅框
  let failureReason: string | null = null;
  let latestMetadata: unknown = message.metadata;
  try {
    const convWithChannel = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        channel: true,
        contact: {
          include: {
            channelIdentities: {
              where: { channelId: conversation.channelId },
              take: 1,
            },
          },
        },
      },
    });

    const channel = convWithChannel?.channel;
    const identity = convWithChannel?.contact?.channelIdentities?.[0];

    logger.info('[ChannelDelivery] Resolving channel', {
      channelType: channel?.channelType ?? 'none',
      isActive: channel?.isActive,
      identity: identity?.uid ?? 'none',
    });

    if (!channel?.isActive) {
      logger.info('[ChannelDelivery] Skipped: channel inactive or missing', { conversationId });
      failureReason = '渠道已停用或不存在，訊息沒有送到顧客';
    } else if (!identity) {
      logger.info('[ChannelDelivery] Skipped: no channelIdentity found for contact', { conversationId, channelType: channel.channelType });
      failureReason = '找不到這位聯絡人在此渠道的帳號，訊息沒有送到顧客';
    } else {
      const plugin = getChannelPlugin(channel.channelType);
      if (!plugin) {
        logger.warn('[ChannelDelivery] Skipped: no plugin for channel type', { channelType: channel.channelType });
        failureReason = '這個渠道類型目前無法從後台送出訊息';
      } else {
        const credentials = channel.channelType === CHANNEL_TYPE.WEBCHAT
          ? {}
          : decryptCredentials(channel.credentialsEncrypted);
        logger.info('[ChannelDelivery] Sending', {
          channelType: channel.channelType,
          to: identity.uid,
          contentType: data.contentType,
          content: stored.content,
        });
        const result = await plugin.sendMessage(
          identity.uid,
          {
            contentType: data.contentType,
            content: stored.content,
            ...(channel.channelType === CHANNEL_TYPE.LINE
              ? { delivery: { retryKey: message.id } }
              : {}),
          },
          credentials,
        );

        delivery = { success: result.success, requestId: result.requestId, error: result.error };
        if (!result.success) {
          failureReason = (result.error || '渠道沒有接受這則訊息').slice(0, 500);
        }

        const updateData: Prisma.MessageUpdateInput = {};
        if (result.success && result.channelMsgId) {
          updateData.channelMsgId = result.channelMsgId;
        }
        if (channel.channelType === CHANNEL_TYPE.LINE) {
          updateData.metadata = mergeLineDeliveryMetadata(message.metadata, message.id, result) as Prisma.InputJsonValue;
          latestMetadata = updateData.metadata;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.message.update({
            where: { id: message.id },
            data: updateData,
          });
          logger.info('[ChannelDelivery] OK', { channelType: channel.channelType, channelMsgId: result.channelMsgId, requestId: result.requestId });
        } else if (!result.success) {
          logger.error('[ChannelDelivery] Failed', { channelType: channel.channelType, error: result.error });
        } else {
          logger.info('[ChannelDelivery] OK (no channelMsgId)', { channelType: channel.channelType });
        }

        // Push outbound message to visitor's widget in real time
        if (channel.channelType === CHANNEL_TYPE.WEBCHAT) {
          const room = `visitor:${channel.id}:${identity.uid}`;
          io.of('/visitor').to(room).emit('agent:message', wsPayload.message);
        }
      }
    }
  } catch (err) {
    // 原始例外（可能含第三方 API 原文、堆疊）只寫 log；回給前端的是可讀說明
    logger.error('[ChannelDelivery] Unexpected error', { error: String(err) });
    delivery = { success: false, error: '訊息未能送出，請稍後重試；若持續失敗請確認渠道設定與額度' };
    failureReason = delivery.error!;
  }

  let returnedMessage = message;
  if (failureReason) {
    const base = latestMetadata && typeof latestMetadata === 'object' && !Array.isArray(latestMetadata)
      ? latestMetadata as Record<string, unknown>
      : {};
    const metadata = { ...base, deliveryFailed: true, deliveryError: failureReason };
    try {
      await prisma.message.update({
        where: { id: message.id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
      returnedMessage = { ...message, metadata: metadata as Prisma.JsonValue };
      // 再推一次 message.new：聊天視窗重新載入，顯示「沒有送出」的紅框
      const failedPayload = { ...wsPayload, message: { ...wsPayload.message, metadata } };
      io.to(`conversation:${conversationId}`).emit('message.new', failedPayload);
      io.to(`tenant:${tenantId}`).emit('message.new', failedPayload);
    } catch (err) {
      logger.error('[ChannelDelivery] 記錄送出失敗標示失敗', { messageId: message.id, error: String(err) });
    }
  }

  // Publish to EventBus
  eventBus.publish({
    name: 'message.sent',
    tenantId,
    timestamp: now,
    payload: {
      conversationId,
      messageId: message.id,
      agentId,
    },
  });

  return { message: returnedMessage, delivery };
}

/**
 * 客服把對話交回 Bot（change add-return-conversation-to-bot）。
 * bot 回覆次數歸零、清除轉真人原因，否則曾因次數到上限轉真人的對話，下一則訊息又會轉回真人。
 * 保留指派的客服：bot 處理不了再轉真人時回到同一位。系統訊息只給客服看，不送給顧客。
 */
export async function returnConversationToBot(
  prisma: TenantDb,
  io: SocketIOServer,
  conversationId: string,
  tenantId: string,
  agentId: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: { channel: { select: { settings: true } } },
  });
  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }
  if (conversation.status === 'CLOSED') {
    throw new AppError('對話已結案，請先重新開啟對話', 'BAD_REQUEST', 400);
  }
  if (conversation.status === 'BOT_HANDLED') {
    throw new AppError('對話已經由機器人處理', 'BAD_REQUEST', 400);
  }
  const settings = (conversation.channel?.settings ?? {}) as { botConfig?: { botMode?: string } };
  if (settings.botConfig?.botMode === 'off') {
    throw new AppError('這個渠道的機器人已關閉，無法交回 Bot', 'BAD_REQUEST', 400);
  }

  // 條件更新：檢查之後若有人把對話結案或已交回，不可以覆蓋（否則已結案的對話會被改回 Bot）
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, tenantId, status: { in: ['AGENT_HANDLED', 'ACTIVE'] } },
    data: { status: 'BOT_HANDLED', botRepliesCount: 0, handoffReason: null },
  });
  if (count === 0) {
    throw new AppError('對話狀態已變更，請重新整理後再試', 'BAD_REQUEST', 400);
  }
  const updated = await prisma.conversation.findFirstOrThrow({ where: { id: conversationId, tenantId } });

  const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { name: true } });
  const now = new Date();
  const storedContent = await prepareStoredMessageContent(prisma, tenantId, { text: `${agent?.name ?? '客服'} 把對話交回 Bot` }, 'system_template');
  const systemMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'system',
      content: storedContent.content,
      metadata: { type: 'return_to_bot', agentId, ...storedContent.metadata },
      isRead: true,
      createdAt: now,
    },
  });

  const wsPayload: ConversationUpdatedPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? now.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
  io.to(`conversation:${conversationId}`).emit('conversation.updated', wsPayload);
  io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

  const msgPayload = {
    conversationId,
    message: {
      id: systemMessage.id,
      conversationId,
      direction: systemMessage.direction,
      senderType: systemMessage.senderType,
      contentType: systemMessage.contentType,
      content: systemMessage.content as Record<string, unknown>,
      createdAt: systemMessage.createdAt.toISOString(),
      sender: null,
    },
  };
  io.to(`conversation:${conversationId}`).emit('message.new', msgPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', msgPayload);

  return updated;
}

export async function handoffConversation(
  prisma: TenantDb,
  io: SocketIOServer,
  conversationId: string,
  tenantId: string,
  agentId: string,
  data: { assignToId?: string; handoffMessage?: string },
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }

  if (conversation.status !== 'BOT_HANDLED') {
    throw new AppError('此對話目前不是由機器人接手，無法執行此操作', 'BAD_REQUEST', 400);
  }

  const now = new Date();

  // Update conversation status to AGENT_HANDLED
  const updateData: Prisma.ConversationUpdateInput = {
    status: 'AGENT_HANDLED',
    handoffReason: 'manual_takeover',
    lastMessageAt: now,
  };

  if (data.assignToId) {
    updateData.assignedTo = { connect: { id: data.assignToId } };
  } else {
    // Assign to the agent performing the handoff
    updateData.assignedTo = { connect: { id: agentId } };
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: updateData,
    include: {
      contact: { select: { id: true, displayName: true, avatarUrl: true } },
      assignedTo: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Send handoff system message
  const handoffText = data.handoffMessage || '稍等，正在為您轉接客服人員';
  // 座席自填的轉接訊息維持遮罩；系統預設文案是固定字串，原文送出（避免 2md 誤判一般詞）
  const storedContent = await prepareStoredMessageContent(prisma, tenantId, { text: handoffText }, data.handoffMessage ? 'system' : 'system_template');
  const systemMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'system',
      content: storedContent.content,
      metadata: { type: 'handoff', fromBot: true, ...storedContent.metadata },
      isRead: true,
      createdAt: now,
    },
    include: {
      sender: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Deliver handoff notification to channel (LINE/FB)
  await deliverToChannel(prisma, conversationId, storedContent.content.text as string);

  // Emit WebSocket events
  const wsPayload: ConversationUpdatedPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: now.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
  io.to(`conversation:${conversationId}`).emit('conversation.updated', wsPayload);
  io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

  const msgPayload = {
    conversationId,
    message: {
      id: systemMessage.id,
      conversationId: systemMessage.conversationId,
      direction: systemMessage.direction,
      senderType: systemMessage.senderType,
      contentType: systemMessage.contentType,
      content: systemMessage.content as Record<string, unknown>,
      createdAt: systemMessage.createdAt.toISOString(),
      sender: null,
    },
  };
  io.to(`conversation:${conversationId}`).emit('message.new', msgPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', msgPayload);

  // Publish event
  eventBus.publish({
    name: 'conversation.updated',
    tenantId,
    timestamp: now,
    payload: { conversationId, status: 'AGENT_HANDLED', handoff: true },
  });

  return updated;
}

/**
 * Lazy Redis publisher for socket bridge (visitor push from bot/auto-reply).
 * Created on first use to avoid connecting at module load time.
 */
let _redisPub: IORedis | null = null;
function getRedisPub(): IORedis {
  if (!_redisPub) {
    _redisPub = new IORedis(getConfig().REDIS_URL);
  }
  return _redisPub;
}

/**
 * Deliver a text message to the external channel (LINE/FB/etc.) via plugin.
 * For WEBCHAT, also pushes the message to the visitor's Socket.IO room via Redis bridge.
 * Non-fatal: errors are logged but not thrown.
 */
/**
 * 把訊息送出 channel。
 * - 傳 string → 當純文字送
 * - 傳 { contentType, content } → 用該 payload 送（例如素材：圖、影片、Flex、Carousel）
 */
export async function deliverToChannel(
  prisma: TenantDb,
  conversationId: string,
  payload: string | { contentType: string; content: Record<string, unknown>; delivery?: ChannelDeliveryOptions },
): Promise<boolean> {
  const outbound = typeof payload === 'string'
    ? { contentType: 'text', content: { text: payload } as Record<string, unknown> }
    : payload;

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        channel: true,
        contact: {
          include: {
            channelIdentities: true,
          },
        },
      },
    });

    if (!conv) { logger.error('[deliverToChannel] Conversation not found:', conversationId); return false; }
    if (!conv.channel?.isActive) { logger.error('[deliverToChannel] Channel inactive or missing for conv:', conversationId); return false; }

    const identity = conv.contact?.channelIdentities?.find(
      (ci) => ci.channelId === conv.channel.id,
    );
    if (!identity) { logger.error('[deliverToChannel] No channel identity found for contact', conv.contact?.id, 'on channel', conv.channel.id); return false; }

    const plugin = getChannelPlugin(conv.channel.channelType);
    if (!plugin) { logger.error('[deliverToChannel] No plugin for channelType:', conv.channel.channelType); return false; }

    let credentials: Record<string, unknown>;
    try {
      credentials = decryptCredentials(conv.channel.credentialsEncrypted);
    } catch (err) {
      logger.error('[deliverToChannel] Failed to decrypt credentials:', err);
      return false;
    }

    logger.info(`[deliverToChannel] Sending to ${conv.channel.channelType} uid=${identity.uid} contentType=${outbound.contentType}`);
    const safeStrategy = conv.channel.channelType === CHANNEL_TYPE.LINE && outbound.delivery
      ? selectSafeLineStrategy({ strategy: outbound.content.strategy, replyToken: outbound.delivery.replyToken, receivedAt: outbound.delivery.receivedAt })
      : undefined;
    const strategy = safeStrategy ?? (outbound.content.strategy as 'reply' | 'push' | undefined);
    const send = async (selectedStrategy: 'reply' | 'push') => {
      const content = {
        ...outbound.content,
        strategy: selectedStrategy,
        ...(selectedStrategy === 'reply' && outbound.delivery?.replyToken
          ? { replyToken: outbound.delivery.replyToken }
          : {}),
      };
      const result = await plugin.sendMessage(identity.uid, { contentType: outbound.contentType, content }, credentials);
      if (!result.success) {
        // 第三方回報的原文寫 log 供排查，不併入對外訊息
        logger.error('[deliverToChannel] 渠道回報送出失敗', {
          conversationId, strategy: selectedStrategy, upstream: result.error,
        });
        throw new AppError(
          '訊息未能送出，請稍後重試；若持續失敗請確認渠道設定與額度',
          'CHANNEL_DELIVERY_FAILED',
          502,
        );
      }
      return result;
    };
    let result;
    try {
      result = await send(strategy ?? 'push');
    } catch (error) {
      if (strategy === 'reply') {
        logger.warn('[SafeReply] LINE reply failed; falling back to push', { conversationId, error });
        result = await send('push');
      } else {
        throw error;
      }
    }
    logger.info(`[deliverToChannel] Sent successfully to uid=${identity.uid}`);

    // For WEBCHAT: push reply to visitor widget via Redis socket bridge
    if (conv.channel.channelType === CHANNEL_TYPE.WEBCHAT) {
      const room = `visitor:${conv.channel.id}:${identity.uid}`;
      const msgPayload = {
        contentType: outbound.contentType,
        content: outbound.content,
        type: outbound.contentType,
        payload: outbound.content,
        direction: 'OUTBOUND',
        senderType: 'BOT',
        channelMsgId: result?.channelMsgId,
        createdAt: new Date().toISOString(),
      };
      getRedisPub()
        .publish('socket:emit', JSON.stringify({ namespace: '/visitor', room, event: 'agent:message', data: msgPayload }))
        .catch((err) => logger.error('[deliverToChannel] Redis publish failed:', err));
    }
    return true;
  } catch (err) {
    logger.error('[deliverToChannel] Error delivering to channel:', err);
    return false;
  }
}

export async function updateConversation(
  prisma: TenantDb,
  io: SocketIOServer,
  id: string,
  tenantId: string,
  data: { status?: string; assignedToId?: string | null },
  options: { actorId?: string } = {},
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
  });

  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }

  // CONV-02：改成 CLOSED 和 POST /:id/close 走同一條結案流程（記錄來源、時間、結案人並發布
  // conversation.closed）。同時改負責人時先改負責人，再結案。已結案的對話照一般更新處理，不重記結案資料。
  const closing = data.status === 'CLOSED' && conversation.status !== 'CLOSED';

  const updateData: Prisma.ConversationUpdateInput = {};

  if (data.status !== undefined && !closing) {
    updateData.status = data.status as any;
  }
  if (data.assignedToId !== undefined) {
    if (data.assignedToId === null) {
      updateData.assignedTo = { disconnect: true };
    } else {
      updateData.assignedTo = { connect: { id: data.assignedToId } };
    }
  }

  if (closing) {
    // 負責人與結案在同一次 update 寫入，避免改了負責人卻沒結案的半套狀態
    return closeConversation(prisma, io, id, tenantId, {
      source: 'manual',
      closedById: options.actorId,
      assignedToId: data.assignedToId,
    });
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: updateData,
    include: {
      contact: {
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
        },
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
    },
  });

  // Emit WebSocket event
  const wsPayload: ConversationUpdatedPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  };

  io.to(`conversation:${id}`).emit('conversation.updated', wsPayload);
  io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

  return updated;
}

/**
 * Close a conversation with optional reason.
 *
 * Sets status=CLOSED, persists `closeReason` + `closeSource` + `closedAt`
 * into conversation.metadata (JSON), emits `conversation.updated` socket
 * event, and publishes `conversation.closed` to the in-process event bus.
 *
 * Idempotent: closing an already-closed conversation is a no-op (returns
 * existing row) so cron / CSAT / case-resolved cascades don't double-fire.
 */
export async function closeConversation(
  prisma: TenantDb,
  io: SocketIOServer,
  id: string,
  tenantId: string,
  options: {
    reason?: string;
    source: 'manual' | 'inactivity' | 'csat' | 'case_resolved';
    closedById?: string;
    /** 同時變更負責人（PATCH 帶 CLOSED 與 assignedToId 時），和結案寫在同一次 update；null 為取消指派 */
    assignedToId?: string | null;
  },
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
  });
  if (!conversation) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }
  if (conversation.status === 'CLOSED') {
    return conversation;
  }

  const existingMeta = (conversation.metadata ?? {}) as Record<string, unknown>;
  const now = new Date();

  // 以條件更新搶「未關閉 → 已關閉」：兩個請求同時關閉時只有一個寫入結案資料與發布事件
  const include = {
    contact: { select: { id: true, displayName: true, avatarUrl: true } },
    assignedTo: { select: { id: true, name: true, avatarUrl: true } },
  } as const;
  const { count } = await prisma.conversation.updateMany({
    where: { id, tenantId, status: { not: 'CLOSED' } },
    data: {
      status: 'CLOSED',
      ...(options.assignedToId !== undefined ? { assignedToId: options.assignedToId } : {}),
      metadata: {
        ...existingMeta,
        closeReason: options.reason ?? null,
        closeSource: options.source,
        closedAt: now.toISOString(),
        closedById: options.closedById ?? null,
      } as Prisma.InputJsonValue,
    },
  });
  const updated = await prisma.conversation.findFirst({ where: { id, tenantId }, include });
  if (!updated) {
    throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
  }
  if (count === 0) {
    return updated;
  }

  const wsPayload: ConversationUpdatedPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
    updatedAt: updated.updatedAt.toISOString(),
  };
  io.to(`conversation:${id}`).emit('conversation.updated', wsPayload);
  io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

  eventBus.publish({
    name: 'conversation.closed',
    tenantId,
    timestamp: now,
    payload: {
      conversationId: id,
      source: options.source,
      reason: options.reason ?? null,
      closedById: options.closedById ?? null,
    },
  });

  return updated;
}

export async function closeConversationsForCase(
  prisma: PrismaClient,
  io: SocketIOServer,
  caseId: string,
  tenantId: string,
  options: {
    reason?: string;
    source: 'csat' | 'case_resolved';
    closedById?: string;
  },
) {
  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      caseId,
      status: { not: 'CLOSED' },
    },
    select: {
      id: true,
      assignedToId: true,
      unreadCount: true,
      lastMessageAt: true,
    },
  });

  if (conversations.length === 0) {
    return 0;
  }

  await prisma.conversation.updateMany({
    where: {
      tenantId,
      caseId,
      status: { not: 'CLOSED' },
    },
    data: {
      status: 'CLOSED',
    },
  });

  const now = new Date();
  for (const conversation of conversations) {
    const wsPayload: ConversationUpdatedPayload = {
      id: conversation.id,
      status: 'CLOSED' as const,
      assignedToId: conversation.assignedToId,
      unreadCount: conversation.unreadCount,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      updatedAt: now.toISOString(),
    };
    io.to(`conversation:${conversation.id}`).emit('conversation.updated', wsPayload);
    io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

    eventBus.publish({
      name: 'conversation.closed',
      tenantId,
      timestamp: now,
      payload: {
        conversationId: conversation.id,
        source: options.source,
        reason: options.reason ?? null,
        closedById: options.closedById ?? null,
      },
    });
  }

  return conversations.length;
}
