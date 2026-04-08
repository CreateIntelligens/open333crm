import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { getChannelPlugin } from '@open333crm/channel-plugins';
import { decryptCredentials } from '../channel/channel.service.js';
import { eventBus } from '../../events/event-bus.js';
import type { ParsedWebhookMessage } from '@open333crm/channel-plugins';
import { trackBroadcastReply } from '../marketing/broadcast.tracking.js';
import { recordCsatScore } from '../csat/csat.service.js';
import { getOutsideHoursMessage } from '../settings/office-hours.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { handleWebhookFlowTrigger } from '../canvas/canvas.webhook.js';
import { resolveUidToContact } from '@open333crm/core';

// Dedup cache for outside-hours auto-replies: key = contactId, value = timestamp
const outsideHoursReplyCache = new Map<string, number>();
const OUTSIDE_HOURS_DEDUP_MS = 30 * 60 * 1000; // 30 minutes

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

  let contactId: string | null = null;

  if (channelIdentity) {
    contactId = channelIdentity.contactId;
  } else {
    const stitchedContactId = await resolveUidToContact(
      tenantId,
      channel.channelType as never,
      contactUid,
    );

    if (stitchedContactId) {
      const stitchedContact = await prisma.contact.findFirst({
        where: { id: stitchedContactId, tenantId },
      });

      if (stitchedContact) {
        contactId = stitchedContact.id;
        channelIdentity = await prisma.channelIdentity.create({
          data: {
            contactId: stitchedContact.id,
            channelId: channel.id,
            channelType: channel.channelType as never,
            uid: contactUid,
            profileName: stitchedContact.displayName,
            profilePic: stitchedContact.avatarUrl ?? null,
          },
          include: { contact: true },
        });
      }
    }
  }

  if (!channelIdentity) {
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

  if (!contactId) {
    throw new Error(`Failed to resolve contact for channel uid ${contactUid}`);
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
    // Determine initial conversation status based on channel botConfig
    let initialStatus: 'BOT_HANDLED' | 'AGENT_HANDLED' = 'BOT_HANDLED';
    try {
      const fullChannel = await prisma.channel.findFirst({
        where: { id: channel.id },
        select: { settings: true },
      });
      const channelSettings = (fullChannel?.settings || {}) as Record<string, unknown>;
      const botConfig = (channelSettings.botConfig || {}) as Record<string, unknown>;
      if (botConfig.botMode === 'off') {
        initialStatus = 'AGENT_HANDLED';
      }
    } catch {
      // fallback to BOT_HANDLED
    }

    conversation = await prisma.conversation.create({
      data: {
        tenantId,
        contactId,
        channelId: channel.id,
        channelType: channel.channelType as any,
        status: initialStatus,
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

  // 3b. Download LINE media content and store in S3 (non-blocking)
  if (channel.channelType === 'LINE' && content.contentId && ['image', 'video', 'audio', 'file'].includes(contentType)) {
    (async () => {
      try {
        const { downloadAndStoreLineMedia } = await import('../storage/line-media.service.js');
        const stored = await downloadAndStoreLineMedia(
          prisma,
          channel.id,
          tenantId,
          content.contentId as string,
          contentType,
          conversation.id,
        );
        if (stored) {
          // Update message content with S3 URL
          const updatedContent = { ...(message.content as Record<string, unknown>), url: stored.url, storageKey: stored.storageKey };
          await prisma.message.update({
            where: { id: message.id },
            data: { content: updatedContent as any },
          });
        }
      } catch (err) {
        console.error('[Webhook] LINE media download error (non-blocking):', err);
      }
    })();
  }

  // 4. Update Conversation
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      unreadCount: { increment: 1 },
    },
  });

  // 5. Intercept CSAT postback responses
  const textContent = (content as Record<string, unknown>).text as string || '';
  const postbackData = (parsed as any).rawPayload?.postback?.data || '';
  const csatMatch = textContent.match(/^csat:(\d):([a-f0-9-]+)$/i)
    || postbackData.match(/^csat:(\d):([a-f0-9-]+)$/i);

  if (csatMatch) {
    const score = parseInt(csatMatch[1], 10);
    const csatCaseId = csatMatch[2];
    if (score >= 1 && score <= 5) {
      await recordCsatScore(prisma, io, csatCaseId, score);
      return; // Don't publish message.received to avoid triggering automations
    }
  }

  // 6. Track broadcast reply (non-blocking)
  trackBroadcastReply(prisma, contactId).catch(() => {});

  // 7. Emit WebSocket events
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

  // 8. Publish to EventBus for automation
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

  await handleWebhookFlowTrigger({
    tenantId,
    channelType: channel.channelType,
    channelId: channel.id,
    contactId,
    eventType: normalizeCanvasEventType(parsed),
    payload: {
      contentType,
      content,
      channelMsgId,
      rawPayload: (parsed as { rawPayload?: Record<string, unknown> }).rawPayload ?? {},
      postbackData,
      text: textContent,
    },
  });

  // 9. Outside office hours auto-reply (30 min dedup per contact)
  try {
    let outsideMsg = await getOutsideHoursMessage(prisma, tenantId);

    // Use channel-specific offline greeting if available
    if (outsideMsg) {
      try {
        const fullChannel = await prisma.channel.findFirst({
          where: { id: channel.id },
          select: { settings: true },
        });
        const channelSettings = (fullChannel?.settings || {}) as Record<string, unknown>;
        const botConfig = (channelSettings.botConfig || {}) as Record<string, unknown>;
        if (botConfig.offlineGreeting && typeof botConfig.offlineGreeting === 'string') {
          outsideMsg = botConfig.offlineGreeting;
        }
      } catch {
        // use default outsideMsg
      }
    }
    if (outsideMsg) {
      const lastReply = outsideHoursReplyCache.get(contactId);
      if (!lastReply || now.getTime() - lastReply > OUTSIDE_HOURS_DEDUP_MS) {
        outsideHoursReplyCache.set(contactId, now.getTime());

        const autoReply = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            senderType: 'SYSTEM',
            contentType: 'text',
            content: { text: outsideMsg },
            metadata: { source: 'office_hours_auto_reply' },
          },
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });

        const autoReplyPayload = {
          conversationId: conversation.id,
          message: {
            id: autoReply.id,
            conversationId: conversation.id,
            direction: 'OUTBOUND',
            senderType: 'SYSTEM',
            contentType: 'text',
            content: { text: outsideMsg },
            createdAt: autoReply.createdAt.toISOString(),
          },
        };

        io.to(`conversation:${conversation.id}`).emit('message.new', autoReplyPayload);
        io.to(`tenant:${tenantId}`).emit('message.new', autoReplyPayload);

        // Deliver to external channel
        await deliverToChannel(prisma, conversation.id, outsideMsg);
      }
    }
  } catch (err) {
    console.error('[Webhook] Office hours auto-reply error:', err);
  }
}

function normalizeCanvasEventType(parsed: ParsedWebhookMessage): string {
  const rawType = (parsed as { eventType?: string; type?: string }).eventType
    ?? (parsed as { eventType?: string; type?: string }).type;

  if (typeof rawType === 'string' && rawType.length > 0) {
    return rawType;
  }

  if (parsed.contentType === 'postback') {
    return 'postback';
  }

  return 'message';
}
