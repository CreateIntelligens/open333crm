import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { AppError } from '../../shared/utils/response.js';
import { eventBus } from '../../events/event-bus.js';
import { trackBroadcastReply } from '../../modules/marketing/broadcast.tracking.js';

export interface SimulatorMessageInput {
  channelType: string;
  channelId: string;
  contactUid: string;
  contactName?: string;
  contentType: string;
  content: Record<string, unknown>;
}

export async function simulateInboundMessage(
  prisma: PrismaClient,
  io: SocketIOServer,
  tenantId: string,
  input: SimulatorMessageInput,
) {
  const {
    channelType,
    channelId,
    contactUid,
    contactName,
    contentType,
    content,
  } = input;

  // 1. Verify channel exists
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId, channelType: channelType as any },
  });

  if (!channel) {
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }

  // 2. Find or create ChannelIdentity + Contact
  let channelIdentity = await prisma.channelIdentity.findUnique({
    where: {
      channelId_uid: { channelId, uid: contactUid },
    },
    include: { contact: true },
  });

  let contactId: string;

  if (channelIdentity) {
    contactId = channelIdentity.contactId;
  } else {
    // Create a new contact and channel identity
    const displayName = contactName ?? `${channelType} User ${contactUid.slice(-6)}`;

    const newContact = await prisma.contact.create({
      data: {
        tenantId,
        displayName,
        language: 'zh-TW',
      },
    });

    contactId = newContact.id;

    channelIdentity = await prisma.channelIdentity.create({
      data: {
        contactId: newContact.id,
        channelId,
        channelType: channelType as any,
        uid: contactUid,
        profileName: displayName,
      },
      include: { contact: true },
    });
  }

  // 3. Find or create Conversation
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId,
      channelId,
      status: { not: 'CLOSED' },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId,
        channelId,
        channelType: channelType as any,
        status: 'BOT_HANDLED',
        unreadCount: 0,
      },
    });

    // Publish conversation.created event for automation
    eventBus.publish({
      name: 'conversation.created',
      tenantId,
      timestamp: new Date(),
      payload: {
        conversationId: conversation.id,
        contactId,
        channelId,
        channelType,
      },
    });
  }

  const now = new Date();

  // 4. Create Message (INBOUND, CONTACT)
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      senderType: 'CONTACT',
      senderId: null,
      contentType,
      content: content as any,
      isRead: false,
      createdAt: now,
    },
  });

  // 5. Update conversation lastMessageAt and increment unreadCount
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      unreadCount: { increment: 1 },
    },
  });

  // 6. Track broadcast reply (non-blocking)
  trackBroadcastReply(prisma, contactId).catch(() => {});

  // 7. Emit WS events
  const wsPayload = {
    conversationId: conversation.id,
    message: {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      senderId: message.senderId,
      contentType: message.contentType,
      content: message.content as Record<string, unknown>,
      createdAt: message.createdAt.toISOString(),
    },
  };

  // Emit to the specific conversation room
  io.to(`conversation:${conversation.id}`).emit('message.new', wsPayload);

  // Emit to tenant-level inbox
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

  // Also emit a conversation.updated event for the unread count change
  const updatedConv = await prisma.conversation.findUnique({
    where: { id: conversation.id },
  });

  if (updatedConv) {
    const convPayload = {
      id: updatedConv.id,
      status: updatedConv.status,
      assignedToId: updatedConv.assignedToId,
      unreadCount: updatedConv.unreadCount,
      lastMessageAt: updatedConv.lastMessageAt?.toISOString() ?? null,
    };

    io.to(`conversation:${conversation.id}`).emit('conversation.updated', convPayload);
    io.to(`tenant:${tenantId}`).emit('conversation.updated', convPayload);
  }

  // 8. Publish to EventBus for automation (KB auto-reply, etc.)
  eventBus.publish({
    name: 'message.received',
    tenantId,
    timestamp: now,
    payload: {
      conversationId: conversation.id,
      messageId: message.id,
      contactId,
      channelId,
      channelType,
      content,
      messageContent: (content.text as string) ?? '',
    },
  });

  return {
    conversationId: conversation.id,
    messageId: message.id,
    contactId,
  };
}
