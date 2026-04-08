import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { Prisma } from '@prisma/client';
import IORedis from 'ioredis';
import { AppError } from '../../shared/utils/response.js';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import { eventBus } from '../../events/event-bus.js';
import { getConfig } from '../../config/env.js';

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

export async function listConversations(
  prisma: PrismaClient,
  tenantId: string,
  filters: ConversationFilters,
  pagination: PaginationParams,
) {
  const where: Prisma.ConversationWhereInput = {
    tenantId,
  };

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
  prisma: PrismaClient,
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
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  return conversation;
}

export async function getMessages(
  prisma: PrismaClient,
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
  prisma: PrismaClient,
  io: SocketIOServer,
  conversationId: string,
  agentId: string,
  tenantId: string,
  data: { contentType: string; content: Record<string, unknown> },
) {
  // Verify conversation exists and belongs to tenant
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
  });

  if (!conversation) {
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  const now = new Date();

  const message = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'AGENT',
      senderId: agentId,
      contentType: data.contentType,
      content: data.content as any,
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
      createdAt: message.createdAt.toISOString(),
      sender: (message as any).sender,
    },
  };

  io.to(`conversation:${conversationId}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

  // --- Channel Delivery: route outbound message through channel plugin ---
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

    if (convWithChannel?.channel?.isActive) {
      const channel = convWithChannel.channel;
      const identity = convWithChannel.contact?.channelIdentities?.[0];

      if (identity) {
        const plugin = getChannelPlugin(channel.channelType);
        if (plugin) {
          const credentials = decryptCredentials(channel.credentialsEncrypted);
          const result = await plugin.sendMessage(
            identity.uid,
            { contentType: data.contentType, content: data.content },
            credentials,
          );

          if (result.success && result.channelMsgId) {
            await prisma.message.update({
              where: { id: message.id },
              data: { channelMsgId: result.channelMsgId },
            });
          } else if (!result.success) {
            console.error(`[ChannelDelivery] Failed to send via ${channel.channelType}:`, result.error);
          }

          // Push outbound message to visitor's widget in real time
          if (channel.channelType === 'WEBCHAT') {
            const room = `visitor:${channel.id}:${identity.uid}`;
            io.of('/visitor').to(room).emit('agent:message', wsPayload.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[ChannelDelivery] Error during channel delivery:', err);
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

  return message;
}

export async function handoffConversation(
  prisma: PrismaClient,
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
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  if (conversation.status !== 'BOT_HANDLED') {
    throw new AppError('Conversation is not in BOT_HANDLED status', 'BAD_REQUEST', 400);
  }

  const now = new Date();

  // Update conversation status to AGENT_HANDLED
  const updateData: Prisma.ConversationUpdateInput = {
    status: 'AGENT_HANDLED',
    handoffReason: 'manual_takeover',
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
  const systemMessage = await prisma.message.create({
    data: {
      conversationId,
      direction: 'OUTBOUND',
      senderType: 'SYSTEM',
      contentType: 'system',
      content: { text: handoffText },
      metadata: { type: 'handoff', fromBot: true },
      isRead: true,
      createdAt: now,
    },
    include: {
      sender: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  // Update lastMessageAt
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now },
  });

  // Deliver handoff notification to channel (LINE/FB)
  await deliverToChannel(prisma, conversationId, handoffText);

  // Emit WebSocket events
  const wsPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: now.toISOString(),
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
export async function deliverToChannel(
  prisma: PrismaClient,
  conversationId: string,
  text: string,
): Promise<void> {
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

    if (!conv) { console.error('[deliverToChannel] Conversation not found:', conversationId); return; }
    if (!conv.channel?.isActive) { console.error('[deliverToChannel] Channel inactive or missing for conv:', conversationId); return; }

    const identity = conv.contact?.channelIdentities?.find(
      (ci) => ci.channelId === conv.channel.id,
    );
    if (!identity) { console.error('[deliverToChannel] No channel identity found for contact', conv.contact?.id, 'on channel', conv.channel.id); return; }

    const plugin = getChannelPlugin(conv.channel.channelType);
    if (!plugin) { console.error('[deliverToChannel] No plugin for channelType:', conv.channel.channelType); return; }

    let credentials: Record<string, unknown>;
    try {
      credentials = decryptCredentials(conv.channel.credentialsEncrypted);
    } catch (err) {
      console.error('[deliverToChannel] Failed to decrypt credentials:', err);
      return;
    }

    console.log(`[deliverToChannel] Sending to ${conv.channel.channelType} uid=${identity.uid}`);
    const result = await plugin.sendMessage(
      identity.uid,
      { contentType: 'text', content: { text } },
      credentials,
    );
    console.log(`[deliverToChannel] Sent successfully to uid=${identity.uid}`);

    // For WEBCHAT: push reply to visitor widget via Redis socket bridge
    if (conv.channel.channelType === 'WEBCHAT') {
      const room = `visitor:${conv.channel.id}:${identity.uid}`;
      const msgPayload = {
        contentType: 'text',
        content: { text },
        direction: 'OUTBOUND',
        senderType: 'BOT',
        channelMsgId: result?.channelMsgId,
        createdAt: new Date().toISOString(),
      };
      getRedisPub()
        .publish('socket:emit', JSON.stringify({ namespace: '/visitor', room, event: 'agent:message', data: msgPayload }))
        .catch((err) => console.error('[deliverToChannel] Redis publish failed:', err));
    }
  } catch (err) {
    console.error('[deliverToChannel] Error delivering to channel:', err);
  }
}

export async function updateConversation(
  prisma: PrismaClient,
  io: SocketIOServer,
  id: string,
  tenantId: string,
  data: { status?: string; assignedToId?: string | null },
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, tenantId },
  });

  if (!conversation) {
    throw new AppError('Conversation not found', 'NOT_FOUND', 404);
  }

  const updateData: Prisma.ConversationUpdateInput = {};

  if (data.status !== undefined) {
    updateData.status = data.status as any;
  }
  if (data.assignedToId !== undefined) {
    if (data.assignedToId === null) {
      updateData.assignedTo = { disconnect: true };
    } else {
      updateData.assignedTo = { connect: { id: data.assignedToId } };
    }
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
  const wsPayload = {
    id: updated.id,
    status: updated.status,
    assignedToId: updated.assignedToId,
    unreadCount: updated.unreadCount,
    lastMessageAt: updated.lastMessageAt?.toISOString() ?? null,
  };

  io.to(`conversation:${id}`).emit('conversation.updated', wsPayload);
  io.to(`tenant:${tenantId}`).emit('conversation.updated', wsPayload);

  return updated;
}
