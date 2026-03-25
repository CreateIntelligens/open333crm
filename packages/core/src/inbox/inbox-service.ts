import { prisma, Direction, SenderType, ConversationStatus } from '@open333crm/database';
import { EventBus } from '../event-bus/event-bus';
import { logger } from '../logger';

export interface IngestMessage {
  tenantId: string;
  contactId: string;
  channelId: string;
  channelType: any;
  direction: Direction;
  senderType: SenderType;
  senderId?: string;
  contentType: string;
  content: any;
  channelMsgId?: string;
}

export class InboxService {
  static async ingest(data: IngestMessage) {
    try {
      // 1. Find or create conversation
      let conversation = await prisma.conversation.findFirst({
        where: {
          tenantId: data.tenantId,
          contactId: data.contactId,
          channelId: data.channelId,
          status: { not: ConversationStatus.CLOSED },
        },
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            tenantId: data.tenantId,
            contactId: data.contactId,
            channelId: data.channelId,
            channelType: data.channelType,
            status: ConversationStatus.ACTIVE,
          },
        });
      }

      // 2. Create message
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: data.direction,
          senderType: data.senderType,
          senderId: data.senderId,
          contentType: data.contentType,
          content: data.content,
          channelMsgId: data.channelMsgId,
        },
      });

      // 3. Update conversation lastMessageAt
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: message.createdAt,
          updatedAt: message.createdAt,
        },
      });

      // 4. Publish to event bus
      await EventBus.publish({
        tenantId: data.tenantId,
        type: 'message.received',
        payload: {
          messageId: message.id,
          conversationId: conversation.id,
          contactId: data.contactId,
          content: data.content,
        },
        timestamp: Date.now(),
      });

      logger.info(`Message ingested: ${message.id} for conversation ${conversation.id}`);
      return message;
    } catch (err) {
      logger.error('Failed to ingest message:', err);
      throw err;
    }
  }
}
