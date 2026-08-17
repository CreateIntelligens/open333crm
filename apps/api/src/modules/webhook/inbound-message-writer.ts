import type { InboundMessageContext, InboundMessageResult } from './inbound-message.types.js';

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

export async function createInboundMessage(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.conversation) throw new Error('Conversation must be resolved before message creation');

  const sequence = await ctx.prisma.message.count({
    where: { conversationId: ctx.conversation.id },
  }) + 1;

  ctx.message = await ctx.prisma.message.create({
    data: {
      conversationId: ctx.conversation.id,
      direction: 'INBOUND',
      senderType: 'CONTACT',
      senderId: null,
      contentType: ctx.contentType,
      content: ctx.content as any,
      metadata: (ctx.options.messageMetadata ?? {}) as any,
      channelMsgId: ctx.channelMsgId ?? null,
      clientMessageId: ctx.options.clientMessageId ?? null,
      sequence,
      isRead: false,
      createdAt: ctx.now,
    },
  });
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
