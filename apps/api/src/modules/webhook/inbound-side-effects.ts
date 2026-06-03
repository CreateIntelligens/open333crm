import { logger } from '@open333crm/core';
import { uploadFile } from '../storage/storage.service.js';
import { trackBroadcastReply } from '../marketing/broadcast.tracking.js';
import { eventBus } from '../../events/event-bus.js';
import { handleWebhookFlowTrigger } from '../canvas/canvas.webhook.js';
import { getOutsideHoursMessage } from '../settings/office-hours.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import type { InboundMessageContext } from './inbound-message.types.js';
import { getBotConfig } from './inbound-message.types.js';
import {
  buildConversationUpdatedPayload,
  buildMessageNewPayload,
  emitToConversationAndTenant,
} from './inbound-socket-presenter.js';

const outsideHoursReplyCache = new Map<string, number>();
const OUTSIDE_HOURS_DEDUP_MS = 30 * 60 * 1000; // 30 minutes

export function resolveInboundMediaAsync(ctx: InboundMessageContext): void {
  if (!ctx.plugin?.resolveInboundMedia || !ctx.message || !ctx.conversation) return;

  const { plugin, content, contentType, credentials, tenantId, conversation, message, prisma, io } = ctx;

  (async () => {
    try {
      const stored = await plugin.resolveInboundMedia!(
        content,
        contentType,
        credentials,
        (buffer, filename, mime) => uploadFile(buffer, filename, mime, tenantId, 'media', conversation.id),
      );
      if (stored) {
        const updatedContent = { ...(message.content as Record<string, unknown>), url: stored.url, storageKey: stored.storageKey };
        await prisma.message.update({
          where: { id: message.id },
          data: { content: updatedContent as any },
        });
        emitToConversationAndTenant(
          io,
          message.conversationId,
          tenantId,
          'message.new',
          buildMessageNewPayload(message, {
            content: updatedContent,
            includeSenderId: true,
            includeTypePayload: true,
          }),
        );
      }
    } catch (err) {
      logger.error('[Webhook] Media resolution error (non-blocking):', err);
    }
  })();
}

export function trackInboundBroadcastReply(ctx: InboundMessageContext): void {
  if (!ctx.contactId) return;
  trackBroadcastReply(ctx.prisma, ctx.contactId).catch(() => {});
}

export async function emitInboundSocketEvents(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.conversation || !ctx.message) {
    throw new Error('Conversation and message must be resolved before socket emission');
  }

  const wsPayload = buildMessageNewPayload(ctx.message, {
    includeSenderId: true,
    includeSequence: true,
    includeTypePayload: true,
  });

  logger.info('[Webhook] Emitting message.new', {
    messageId: ctx.message.id,
    conversationId: ctx.conversation.id,
    contentType: ctx.contentType,
  });
  emitToConversationAndTenant(ctx.io, ctx.conversation.id, ctx.tenantId, 'message.new', wsPayload);

  const updatedConv = await ctx.prisma.conversation.findUnique({
    where: { id: ctx.conversation.id },
  });

  if (updatedConv) {
    const convPayload = buildConversationUpdatedPayload(updatedConv);
    emitToConversationAndTenant(ctx.io, ctx.conversation.id, ctx.tenantId, 'conversation.updated', convPayload);
  }
}

export function publishMessageReceived(ctx: InboundMessageContext): void {
  if (!ctx.conversation || !ctx.message || !ctx.contactId) {
    throw new Error('Contact, conversation, and message must be resolved before EventBus publication');
  }

  eventBus.publish({
    name: 'message.received',
    tenantId: ctx.tenantId,
    timestamp: ctx.now,
    payload: {
      conversationId: ctx.conversation.id,
      messageId: ctx.message.id,
      contactId: ctx.contactId,
      channelId: ctx.channel.id,
      channelType: ctx.channel.channelType,
      content: ctx.content,
      messageContent: (ctx.content.text as string) ?? '',
    },
  });
}

export async function triggerWebhookFlow(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.contactId) throw new Error('Contact must be resolved before canvas webhook trigger');

  await handleWebhookFlowTrigger({
    tenantId: ctx.tenantId,
    channelType: ctx.channel.channelType,
    channelId: ctx.channel.id,
    contactId: ctx.contactId,
    eventType: normalizeCanvasEventType(ctx),
    payload: {
      contentType: ctx.contentType,
      content: ctx.content,
      channelMsgId: ctx.channelMsgId,
      rawPayload: (ctx.parsed as { rawPayload?: Record<string, unknown> }).rawPayload ?? {},
      postbackData: ctx.postbackData,
      text: ctx.textContent,
    },
  });
}

export async function sendOutsideHoursAutoReply(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.conversation || !ctx.contactId) {
    throw new Error('Contact and conversation must be resolved before office-hours auto-reply');
  }

  try {
    let outsideMsg = await getOutsideHoursMessage(ctx.prisma, ctx.tenantId);

    if (outsideMsg) {
      try {
        const botConfig = await getBotConfig(ctx);
        if (botConfig.offlineGreeting && typeof botConfig.offlineGreeting === 'string') {
          outsideMsg = botConfig.offlineGreeting;
        }
      } catch {
        // use default outsideMsg
      }
    }
    if (outsideMsg) {
      const lastReply = outsideHoursReplyCache.get(ctx.contactId);
      if (!lastReply || ctx.now.getTime() - lastReply > OUTSIDE_HOURS_DEDUP_MS) {
        outsideHoursReplyCache.set(ctx.contactId, ctx.now.getTime());

        const autoReply = await ctx.prisma.message.create({
          data: {
            conversationId: ctx.conversation.id,
            direction: 'OUTBOUND',
            senderType: 'SYSTEM',
            contentType: 'text',
            content: { text: outsideMsg },
            metadata: { source: 'office_hours_auto_reply' },
          },
        });

        await ctx.prisma.conversation.update({
          where: { id: ctx.conversation.id },
          data: { lastMessageAt: new Date() },
        });

        const autoReplyPayload = buildMessageNewPayload(autoReply, {
          content: { text: outsideMsg },
          includeTypePayload: true,
        });

        emitToConversationAndTenant(ctx.io, ctx.conversation.id, ctx.tenantId, 'message.new', autoReplyPayload);

        await deliverToChannel(ctx.prisma, ctx.conversation.id, outsideMsg);
      }
    }
  } catch (err) {
    logger.error('[Webhook] Office hours auto-reply error:', err);
  }
}

function normalizeCanvasEventType(ctx: InboundMessageContext): string {
  const rawType = (ctx.parsed as { eventType?: string; type?: string }).eventType
    ?? (ctx.parsed as { eventType?: string; type?: string }).type;

  if (typeof rawType === 'string' && rawType.length > 0) {
    return rawType;
  }

  if (ctx.parsed.contentType === 'postback') {
    return 'postback';
  }

  return 'message';
}
