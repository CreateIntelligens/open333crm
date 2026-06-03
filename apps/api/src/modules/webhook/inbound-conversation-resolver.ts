import { eventBus } from '../../events/event-bus.js';
import type { InboundMessageContext } from './inbound-message.types.js';
import { getBotConfig } from './inbound-message.types.js';

export async function resolveInboundConversation(ctx: InboundMessageContext): Promise<void> {
  if (!ctx.contactId) {
    throw new Error(`Failed to resolve contact for channel uid ${ctx.contactUid}`);
  }

  let conversation = ctx.options.conversationId
    ? await ctx.prisma.conversation.findFirst({
        where: {
          id: ctx.options.conversationId,
          tenantId: ctx.tenantId,
          contactId: ctx.contactId,
          channelId: ctx.channel.id,
          status: { not: 'CLOSED' },
        },
      })
    : await ctx.prisma.conversation.findFirst({
        where: {
          tenantId: ctx.tenantId,
          contactId: ctx.contactId,
          channelId: ctx.channel.id,
          status: { not: 'CLOSED' },
        },
        orderBy: { lastMessageAt: 'desc' },
      });

  if (!conversation) {
    let initialStatus: 'BOT_HANDLED' | 'AGENT_HANDLED' = 'BOT_HANDLED';
    try {
      const botConfig = await getBotConfig(ctx);
      if (botConfig.botMode === 'off') {
        initialStatus = 'AGENT_HANDLED';
      }
    } catch {
      // fallback to BOT_HANDLED
    }

    conversation = await ctx.prisma.conversation.create({
      data: {
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        channelId: ctx.channel.id,
        channelType: ctx.channel.channelType as any,
        status: initialStatus,
        unreadCount: 0,
      },
    });

    eventBus.publish({
      name: 'conversation.created',
      tenantId: ctx.tenantId,
      timestamp: new Date(),
      payload: {
        conversationId: conversation.id,
        contactId: ctx.contactId,
        channelId: ctx.channel.id,
        channelType: ctx.channel.channelType,
      },
    });
  }

  ctx.conversation = conversation;
}
