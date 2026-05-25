export interface ConversationUpdatedPayload {
  id: string;
  status?: string;
  assignedToId?: string | null;
  unreadCount?: number;
  lastMessageAt?: string | null;
  updatedAt: string;
  handoffReason?: string;
  source?: string;
}

export interface WsMessageNew {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    direction: string;
    senderType: string;
    senderId?: string;
    contentType: string;
    content: Record<string, unknown>;
    createdAt: string;
  };
}

export type WsConversationUpdated = ConversationUpdatedPayload;

export interface WsCaseUpdated {
  id: string;
  status: string;
  priority: string;
  assigneeId?: string;
}
