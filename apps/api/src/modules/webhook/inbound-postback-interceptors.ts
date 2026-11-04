import { logger } from '@open333crm/core';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import { eventBus } from '../../events/event-bus.js';
import { recordCsatScore, relabelCsatReplyMessage } from '../csat/csat.service.js';
import { deliverToChannel } from '../conversation/conversation.service.js';
import { recordKbFeedback } from '../knowledge/kb-feedback.service.js';
import { addTagToTargetFlow } from '../tag/tag.flow.js';
import type { InboundMessageContext } from './inbound-message.types.js';
import { getBotConfig } from './inbound-message.types.js';
import { prepareStoredMessageContent } from '../ai/deidentification.service.js';
import {
  buildConversationUpdatedPayload,
  buildMessageNewPayload,
  emitToConversationChannel,
} from './inbound-socket-presenter.js';

export async function runInboundPostbackInterceptors(ctx: InboundMessageContext): Promise<boolean> {
  // 點擊貼標：附加語意，不短路（貼完標仍讓該 postback 走後續 CSAT/KB/handoff 與正常訊息流程）。
  await handleTagOnClick(ctx);

  if (await handleCsatResponse(ctx)) return true;
  if (await handleKbFeedback(ctx)) return true;
  if (await handleHandoffRequest(ctx)) return true;
  return false;
}

/**
 * 素材 action 點擊後貼標：postback data（或 fallback textContent）為 `tag:<tagId>` 時，
 * 對點擊者（contact）貼上該 CONTACT-scope 標籤。fire-and-forget——標籤不存在/scope 不符/
 * 缺 contactId 都靜默略過，絕不中斷後續 postback 處理。貼標與 contact.tagged 在同一個交易內寫入
 * （迴圈防護內建），既有訂閱該事件的自動化自動被觸發；貼標失敗時整個交易 rollback，事件也不送出。
 */
async function handleTagOnClick(ctx: InboundMessageContext): Promise<void> {
  const source = ctx.postbackData || ctx.textContent || '';
  const match = source.match(/^tag:([0-9a-f-]{36})$/i);
  if (!match) return;
  if (!ctx.contactId) return;

  try {
    await addTagToTargetFlow({ prisma: ctx.prisma }, ctx.tenantId, {
      targetType: 'CONTACT',
      targetId: ctx.contactId,
      tagId: match[1],
      addedBy: 'system',
    });
  } catch (err) {
    // 標籤已刪/scope 不符/其他 → 靜默略過，不影響此 postback 的其他處理。
    logger.debug('[Webhook] tag-on-click 貼標略過:', err);
  }
}

async function handleCsatResponse(ctx: InboundMessageContext): Promise<boolean> {
  const csatPattern = /^csat:(\d):([a-f0-9-]+)$/i;
  const csatMatch = ctx.textContent.match(csatPattern) || ctx.postbackData.match(csatPattern);

  if (!csatMatch) return false;

  const score = parseInt(csatMatch[1], 10);
  const csatCaseId = csatMatch[2];
  if (score < 1 || score > 5) return false;

  // 收件匣顯示客人在 LINE 上看到的「我的評分：N 分」，不顯示 csat: 代碼（issue #444）。
  // 判斷已經用 ctx.textContent／ctx.postbackData 做完，只改寫存下來的訊息。
  // LINE 按鈕的 postback 客人看到的就是 displayText，先改寫，接著的問卷與感謝訊息推送時收件匣就是文字；
  // 客人手打的代碼要等評分確實記錄才改寫，偽造或別人工單的代碼維持原文（PR #455 審查）
  const fromButton = csatPattern.test(ctx.postbackData);
  const relabel = async () => {
    if (!ctx.message) return;
    try {
      await relabelCsatReplyMessage({ tx: ctx.prisma, tenantId: ctx.tenantId }, {
        messageId: ctx.message.id,
        messageMetadata: ctx.message.metadata,
        score,
        postbackData: csatMatch[0],
      });
    } catch (err) {
      // 改寫失敗只影響顯示，評分照常記錄
      logger.error('[Webhook] CSAT 評分訊息改寫失敗:', err);
    }
  };
  if (fromButton) await relabel();

  // 只接受同租戶、傳訊者本人的工單；不符時仍攔截，避免偽造的評分落入 AI 與自動化（AUDIT RLS-06）
  const recorded = ctx.contactId
    ? await recordCsatScore(ctx.prisma, ctx.io, csatCaseId, score, undefined, {
      tenantId: ctx.tenantId,
      contactId: ctx.contactId,
    })
    : false;
  if (recorded && !fromButton) await relabel();
  if (!recorded) {
    logger.warn(
      `[Webhook] CSAT 未記錄：工單不存在、已評分，或不屬於此租戶與聯絡人 tenant=${ctx.tenantId} contact=${ctx.contactId ?? '-'} case=${csatCaseId}`,
    );
  }
  return true;
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
      const storedContent = await prepareStoredMessageContent(ctx.prisma, ctx.tenantId, { text: '使用者主動點按按鈕轉接人工客服' }, 'system_template');
      const systemMessage = await ctx.prisma.message.create({
        data: {
          conversationId: ctx.conversation.id,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          contentType: 'system',
          content: storedContent.content,
          metadata: { type: 'user_requested_handoff', reason, ...storedContent.metadata },
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
      emitToConversationChannel(
        ctx.io,
        ctx.tenantId,
        ctx.conversation,
        'conversation.updated',
        convPayload,
      );

      // 與其他 message.new 相同送到渠道房間（issue #427、PR #438 審查）
      emitToConversationChannel(ctx.io, ctx.tenantId, ctx.conversation, 'message.new', buildMessageNewPayload(systemMessage, {
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
