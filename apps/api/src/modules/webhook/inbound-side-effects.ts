import { logger } from '@open333crm/core';
import { uploadFile } from '../storage/storage.service.js';
import { trackBroadcastReply } from '../marketing/broadcast.tracking.js';
import { eventBus } from '../../events/event-bus.js';
import { handleWebhookFlowTrigger } from '../canvas/canvas.webhook.js';
import { getOutsideHoursMessage } from '../settings/office-hours.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import type { InboundMessageContext } from './inbound-message.types.js';
import { getBotConfig, getChannelSettings } from './inbound-message.types.js';
import { renderTemplateBody } from '../marketing/template-renderer.js';
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

  const rawPayload = (ctx.parsed as { rawPayload?: { replyToken?: unknown } }).rawPayload;
  const replyToken = typeof rawPayload?.replyToken === 'string' ? rawPayload.replyToken : undefined;

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
      contentType: ctx.contentType,
      content: ctx.content,
      messageContent: (ctx.content.text as string) ?? '',
      replyToken,
      receivedAt: ctx.now.toISOString(),
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

/**
 * 首次進站招呼語（CM-176）。
 *
 * 粉絲在此渠道首次被建立身分時，送出一則歡迎訊息。觸發判定由
 * resolveInboundContact 設定的 ctx.isFirstContact 決定 —— 該旗標源自
 * ChannelIdentity 的 @@unique([channelId, uid])：只有成功建立身分的那次
 * 請求為 true，併發／平台重複投遞會撞 P2002 而維持 false。
 *
 * 刻意不用 outsideHoursReplyCache 那種記憶體 Map 去重：本專案多實例部署
 * （見 PR #157），記憶體快取會讓每個實例各送一次。outside-hours 用得上是
 * 因為它是「30 分鐘內去重」的寬鬆語意，重複一次可接受；招呼語是「一輩子
 * 只送一次」，必須靠 DB 唯一約束。
 *
 * 整段 try/catch 隔離：招呼語失敗不得影響 inbound 訊息落地（CM-175 的教訓）。
 */
export async function sendFirstContactGreeting(
  ctx: InboundMessageContext,
  // 發送函式以參數注入，預設走真實管線；測試可替換以驗證行為（ESM module 物件唯讀，無法猴子補丁）
  deliver: typeof deliverToChannel = deliverToChannel,
): Promise<void> {
  if (!ctx.isFirstContact) return;

  try {
    if (!ctx.conversation || !ctx.contactId) return;

    const channelSettings = await getChannelSettings(ctx);
    const raw = channelSettings.firstContactGreeting;
    const template = typeof raw === 'string' ? raw.trim() : '';
    if (!template) return; // 未設定 = 功能關閉，維持現狀

    // 變數替換失敗不擋發送，退回原字串。
    let greeting = template;
    try {
      const contact = ctx.channelIdentity?.contact as
        | { displayName?: string | null; phone?: string | null; email?: string | null }
        | undefined;

      greeting = renderTemplateBody(template, {
        'contact.name': contact?.displayName ?? '',
        'contact.phone': contact?.phone ?? '',
        'contact.email': contact?.email ?? '',
      });
    } catch (err) {
      logger.warn('[Webhook] First-contact greeting variable render failed, sending raw template', err);
    }

    const message = await ctx.prisma.message.create({
      data: {
        conversationId: ctx.conversation.id,
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        contentType: 'text',
        content: { text: greeting },
        metadata: { source: 'first_contact_greeting' },
      },
    });

    await ctx.prisma.conversation.update({
      where: { id: ctx.conversation.id },
      data: { lastMessageAt: new Date() },
    });

    const payload = buildMessageNewPayload(message, {
      content: { text: greeting },
      includeTypePayload: true,
    });
    emitToConversationAndTenant(ctx.io, ctx.conversation.id, ctx.tenantId, 'message.new', payload);

    await deliver(ctx.prisma, ctx.conversation.id, greeting);

    logger.info('[Webhook] First-contact greeting sent', {
      conversationId: ctx.conversation.id,
      contactId: ctx.contactId,
      channelType: ctx.channel.channelType,
    });
  } catch (err) {
    logger.error('[Webhook] First-contact greeting error:', err);
  }
}
