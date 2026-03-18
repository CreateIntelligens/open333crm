import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { getChannelPlugin } from '../../channels/registry.js';
import { decryptCredentials } from '../channel/channel.service.js';
import { eventBus } from '../../events/event-bus.js';
import type { ParsedWebhookMessage } from '../../channels/base.plugin.js';

export async function processWebhookEvent(
  prisma: PrismaClient,
  io: SocketIOServer,
  channelId: string,
  channelType: string,
  rawBody: Buffer,
  headers: Record<string, string>,
) {
  // 1. Load channel from DB
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, isActive: true },
  });

  if (!channel) {
    throw new Error(`Channel not found or inactive: ${channelId}`);
  }

  const tenantId = channel.tenantId;

  // 2. Get plugin and decrypt credentials
  const plugin = getChannelPlugin(channelType);
  if (!plugin) {
    throw new Error(`No plugin for channel type: ${channelType}`);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  // LINE uses channelSecret, FB uses appSecret for signature verification
  const secret = (channelType === 'FB'
    ? credentials.appSecret
    : credentials.channelSecret) as string;

  // 3. Verify signature
  if (!plugin.verifySignature(rawBody, headers, secret)) {
    throw new Error('Invalid webhook signature');
  }

  // 4. Parse webhook into normalized messages
  const parsedMessages = await plugin.parseWebhook(rawBody, headers);

  // 5. Process each message (same pattern as simulator.service.ts)
  for (const parsed of parsedMessages) {
    await processInboundMessage(prisma, io, credentials, channel, tenantId, parsed);
  }
}

async function processInboundMessage(
  prisma: PrismaClient,
  io: SocketIOServer,
  credentials: Record<string, unknown>,
  channel: { id: string; channelType: string },
  tenantId: string,
  parsed: ParsedWebhookMessage,
) {
  const { contactUid, contentType, content, channelMsgId } = parsed;

  if (!contactUid) return;

  // 1. Find or create ChannelIdentity + Contact
  let channelIdentity = await prisma.channelIdentity.findUnique({
    where: {
      channelId_uid: { channelId: channel.id, uid: contactUid },
    },
    include: { contact: true },
  });

  let contactId: string;

  if (channelIdentity) {
    contactId = channelIdentity.contactId;
  } else {
    // Fetch real profile from channel API
    const plugin = getChannelPlugin(channel.channelType);
    let displayName = `${channel.channelType} User ${contactUid.slice(-6)}`;
    let avatarUrl: string | undefined;

    if (plugin) {
      try {
        const profile = await plugin.getProfile(contactUid, credentials);
        displayName = profile.displayName;
        avatarUrl = profile.avatarUrl;
      } catch {
        // Use fallback name
      }
    }

    const newContact = await prisma.contact.create({
      data: {
        tenantId,
        displayName,
        avatarUrl: avatarUrl ?? null,
        language: 'zh-TW',
      },
    });

    contactId = newContact.id;

    channelIdentity = await prisma.channelIdentity.create({
      data: {
        contactId: newContact.id,
        channelId: channel.id,
        channelType: channel.channelType as any,
        uid: contactUid,
        profileName: displayName,
        profilePic: avatarUrl ?? null,
      },
      include: { contact: true },
    });
  }

  // 2. Find or create Conversation
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId,
      channelId: channel.id,
      status: { not: 'CLOSED' },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId,
        channelId: channel.id,
        channelType: channel.channelType as any,
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
        channelId: channel.id,
        channelType: channel.channelType,
      },
    });
  }

  const now = new Date();

  // 3. Create Message (INBOUND)
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      senderType: 'CONTACT',
      senderId: null,
      contentType,
      content: content as any,
      channelMsgId: channelMsgId ?? null,
      isRead: false,
      createdAt: now,
    },
  });

  // 4. Update Conversation
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      unreadCount: { increment: 1 },
    },
  });

  // 5. Emit WebSocket events
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

  io.to(`conversation:${conversation.id}`).emit('message.new', wsPayload);
  io.to(`tenant:${tenantId}`).emit('message.new', wsPayload);

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

  // 6. Publish to EventBus for automation
  eventBus.publish({
    name: 'message.received',
    tenantId,
    timestamp: now,
    payload: {
      conversationId: conversation.id,
      messageId: message.id,
      contactId,
      channelId: channel.id,
      channelType: channel.channelType,
      content,
      messageContent: (content.text as string) ?? '',
    },
  });
}
