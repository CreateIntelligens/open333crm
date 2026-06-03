import type { Conversation, Message } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { ConversationUpdatedPayload } from '@open333crm/shared';

export function buildMessageNewPayload(
  message: Pick<Message, 'id' | 'conversationId' | 'direction' | 'senderType' | 'senderId' | 'contentType' | 'content' | 'createdAt'> & {
    sequence?: number | null;
    metadata?: unknown;
  },
  options: {
    content?: Record<string, unknown>;
    includeSenderId?: boolean;
    includeSequence?: boolean;
    includeTypePayload?: boolean;
    includeMetadata?: boolean;
    includeSenderNull?: boolean;
  } = {},
) {
  const content = options.content ?? (message.content as Record<string, unknown>);
  return {
    conversationId: message.conversationId,
    message: {
      id: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      senderType: message.senderType,
      ...(options.includeSenderId ? { senderId: message.senderId } : {}),
      contentType: message.contentType,
      content,
      ...(options.includeTypePayload ? { type: message.contentType, payload: content } : {}),
      createdAt: message.createdAt.toISOString(),
      ...(options.includeSequence ? { sequence: message.sequence } : {}),
      ...(options.includeMetadata ? { metadata: message.metadata } : {}),
      ...(options.includeSenderNull ? { sender: null } : {}),
    },
  };
}

export function buildConversationUpdatedPayload(
  conversation: Pick<Conversation, 'id' | 'status' | 'assignedToId' | 'unreadCount' | 'lastMessageAt' | 'updatedAt'>,
  extra: Partial<ConversationUpdatedPayload> = {},
): ConversationUpdatedPayload {
  return {
    id: conversation.id,
    status: conversation.status,
    assignedToId: conversation.assignedToId,
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    updatedAt: conversation.updatedAt.toISOString(),
    ...extra,
  };
}

export function emitToConversationAndTenant(
  io: SocketIOServer,
  conversationId: string,
  tenantId: string,
  event: string,
  payload: unknown,
) {
  io.to(`conversation:${conversationId}`).emit(event, payload);
  io.to(`tenant:${tenantId}`).emit(event, payload);
}
