import { logger } from '@open333crm/core';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import { eventBus } from '../../events/event-bus.js';
import { recordCsatScore } from '../csat/csat.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { recordKbFeedback } from '../knowledge/kb-feedback.service.js';
import type { InboundMessageContext } from './inbound-message.types.js';
import { getBotConfig } from './inbound-message.types.js';
import {
  buildConversationUpdatedPayload,
  buildMessageNewPayload,
  emitToConversationAndTenant,
} from './inbound-socket-presenter.js';

export async function runInboundPostbackInterceptors(ctx: InboundMessageContext): Promise<boolean> {
  if (await handleCsatResponse(ctx)) return true;
  if (await handleKbFeedback(ctx)) return true;
  if (await handleHandoffRequest(ctx)) return true;
  return false;
}

async function handleCsatResponse(ctx: InboundMessageContext): Promise<boolean> {
  const csatMatch = ctx.textContent.match(/^csat:(\d):([a-f0-9-]+)$/i)
    || ctx.postbackData.match(/^csat:(\d):([a-f0-9-]+)$/i);

  if (!csatMatch) return false;

  const score = parseInt(csatMatch[1], 10);
  const csatCaseId = csatMatch[2];
  if (score >= 1 && score <= 5) {
    await recordCsatScore(ctx.prisma, ctx.io, csatCaseId, score);
    return true;
  }
  return false;
}

async function handleKbFeedback(ctx: InboundMessageContext): Promise<boolean> {
  const fbPattern = /^kb_feedback:(bad|good):([a-f0-9-]+|none):([a-f0-9-]+)$/i;
  const fbMatch = ctx.postbackData.match(fbPattern) || ctx.textContent.match(fbPattern);
  if (!fbMatch) return false;

  const rating = fbMatch[1] as 'bad' | 'good';
  const articleId = fbMatch[2];
  const fbMessageId = fbMatch[3];
  try {
    await recordKbFeedback(ctx.prisma, ctx.tenantId, {
      rating,
      articleId,
      messageId: fbMessageId,
      contactId: ctx.contactId ?? undefined,
    });
    if (ctx.conversation) {
      await deliverToChannel(ctx.prisma, ctx.conversation.id, '感謝您的回報，我們會持續改善 🙏');
    }
  } catch (err) {
    logger.error('[Webhook] KB feedback handling failed:', err);
  }
  return true;
}

async function handleHandoffRequest(ctx: InboundMessageContext): Promise<boolean> {
  if (!/^handoff_request$/i.test(ctx.postbackData) && !/^handoff_request$/i.test(ctx.textContent)) {
    return false;
  }

  if (!ctx.conversation) throw new Error('Conversation must be resolved before handoff intercept');

  try {
    const botConfig = await getBotConfig(ctx);
    const handoffMessage =
      (botConfig.handoffMessage as string | undefined) || '稍等，正在為您轉接客服人員';

    if (ctx.conversation.status === 'AGENT_HANDLED') {
      await deliverToChannel(ctx.prisma, ctx.conversation.id, handoffMessage);
      logger.info('[Webhook] handoff_request on AGENT_HANDLED conv (idempotent)', {
        conversationId: ctx.conversation.id,
      });
    } else if (ctx.conversation.status === 'BOT_HANDLED') {
      const reason = 'user_requested_handoff';
      const systemMessage = await ctx.prisma.message.create({
        data: {
          conversationId: ctx.conversation.id,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: { text: '使用者主動點按按鈕轉接人工客服' },
          metadata: { type: 'user_requested_handoff', reason },
          isRead: true,
          createdAt: new Date(),
        },
      });

      const updatedConversation = await ctx.prisma.conversation.update({
        where: { id: ctx.conversation.id },
        data: {
          status: 'AGENT_HANDLED',
          handoffReason: reason,
          lastMessageAt: new Date(),
        },
      });

      await deliverToChannel(ctx.prisma, ctx.conversation.id, handoffMessage);

      eventBus.publish({
        name: 'conversation.handoff',
        tenantId: ctx.tenantId,
        timestamp: new Date(),
        payload: {
          conversationId: ctx.conversation.id,
          reason,
          previousStatus: 'BOT_HANDLED',
        },
      });

      const convPayload: ConversationUpdatedPayload = buildConversationUpdatedPayload(updatedConversation, {
        handoffReason: reason,
      });
      emitToConversationAndTenant(
        ctx.io,
        ctx.conversation.id,
        ctx.tenantId,
        'conversation.updated',
        convPayload,
      );

      ctx.io.to(`conversation:${ctx.conversation.id}`).emit('message.new', buildMessageNewPayload(systemMessage, {
        includeMetadata: true,
        includeSenderNull: true,
      }));

      logger.info('[Webhook] handoff_request → AGENT_HANDLED', {
        conversationId: ctx.conversation.id,
      });
    } else {
      logger.warn('[Webhook] handoff_request ignored (unexpected status)', {
        conversationId: ctx.conversation.id,
        status: ctx.conversation.status,
      });
    }
  } catch (err) {
    logger.error('[Webhook] handoff_request handling failed:', err);
  }

  return true;
}
