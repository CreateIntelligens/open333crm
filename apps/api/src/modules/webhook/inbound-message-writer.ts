import type { InboundMessageContext, InboundMessageResult } from './inbound-message.types.js';
import { prepareInboundMessageContent } from '../ai/deidentification.service.js';
import { alertInboundUnmasked } from '../ai/deidentification-alert.js';
import { readAiPrivacyPolicy } from '../platform/ai-privacy.service.js';

export async function findDuplicateInboundMessage(
  ctx: InboundMessageContext,
): Promise<InboundMessageResult | null> {
  if (!ctx.conversation) throw new Error('Conversation must be resolved before duplicate check');

  // clientMessageId 去重（樂觀更新 / WebChat 場景）
  if (ctx.options.clientMessageId) {
    const existingMessage = await ctx.prisma.message.findUnique({
      where: {
        conversationId_clientMessageId: {
          conversationId: ctx.conversation.id,
          clientMessageId: ctx.options.clientMessageId,
        },
      },
    });
    if (existingMessage) {
      return { conversation: ctx.conversation, message: existingMessage, duplicate: true };
    }
  }

  // channelMsgId 去重（IG/FB 等平台會重複投遞同一 webhook 事件；channelMsgId = 平台訊息 id）
  // channelMsgId 無 DB unique 約束，這裡以應用層查重擋掉重複建立與重複觸發 Bot。
  if (ctx.channelMsgId) {
    const existingByChannelMsg = await ctx.prisma.message.findFirst({
      where: {
        conversationId: ctx.conversation.id,
        channelMsgId: ctx.channelMsgId,
      },
    });
    if (existingByChannelMsg) {
      return { conversation: ctx.conversation, message: existingByChannelMsg, duplicate: true };
    }
  }

  return null;
}

/**
 * 建立 inbound 訊息。回傳 true 代表正常建立；回傳 false 代表併發競態下撞到
 * (conversationId, channelMsgId) unique 約束（平台重複投遞的同一則），呼叫端應視為
 * 重複、提早結束，不再觸發 Bot / socket。findDuplicateInboundMessage 的應用層查重
 * 擋掉先後到達的重複，此處的 P2002 擋掉「幾乎同時」的併發重複。
 */
export async function createInboundMessage(ctx: InboundMessageContext): Promise<boolean> {
  if (!ctx.conversation) throw new Error('Conversation must be resolved before message creation');

  const sequence = await ctx.prisma.message.count({
    where: { conversationId: ctx.conversation.id },
  }) + 1;
  // 去識別化服務無法使用時不丟錯：存原文並標記未遮罩，AI 不讀這則訊息、改轉真人（issue #466）
  const stored = await prepareInboundMessageContent(await readAiPrivacyPolicy(ctx.prisma, ctx.tenantId), ctx.content);

  try {
    ctx.message = await ctx.prisma.message.create({
      data: {
        conversationId: ctx.conversation.id,
        direction: 'INBOUND',
        senderType: 'CONTACT',
        senderId: null,
        contentType: ctx.contentType,
        content: stored.content as any,
        metadata: { ...(ctx.options.messageMetadata ?? {}), ...stored.metadata } as any,
        channelMsgId: ctx.channelMsgId ?? null,
        clientMessageId: ctx.options.clientMessageId ?? null,
        sequence,
        isRead: false,
        createdAt: ctx.now,
      },
    });
    // 訊息存入之後、不在交易內發告警；sendOpsAlert() 合併 10 分鐘內的告警
    if (stored.unmaskedReason) {
      await alertInboundUnmasked({ tenantId: ctx.tenantId, channelType: ctx.channel.channelType, reason: stored.unmaskedReason });
    }
    return true;
  } catch (err) {
    // P2002：併發下另一請求已先建立同一 (conversationId, channelMsgId) → 視為重複
    if ((err as { code?: string }).code === 'P2002' && ctx.channelMsgId) {
      const existing = await ctx.prisma.message.findFirst({
        where: { conversationId: ctx.conversation.id, channelMsgId: ctx.channelMsgId },
      });
      if (existing) {
        ctx.message = existing;
        return false;
      }
    }
    throw err;
  }
}

export async function updateConversationAfterInboundMessage(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.conversation) throw new Error('Conversation must be resolved before conversation update');

  await ctx.prisma.conversation.update({
    where: { id: ctx.conversation.id },
    data: {
      lastMessageAt: ctx.now,
      unreadCount: { increment: 1 },
    },
  });
}
