import type { Conversation, Message } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import { emitToChannel, type ChannelPushName } from '../../events/socket-push.js';

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

/**
 * 推到對話房間與該對話渠道的房間：只有看得到這個渠道的成員收到（issue #427）。
 * 不推到全租戶房間；房間由 events/socket-push.ts 決定。
 */
export function emitToConversationChannel(
  io: SocketIOServer,
  tenantId: string,
  conversation: Pick<Conversation, 'id' | 'channelId'>,
  event: ChannelPushName,
  payload: unknown,
) {
  emitToChannel(io, tenantId, { channelId: conversation.channelId, conversationId: conversation.id }, event, payload);
}
