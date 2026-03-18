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

export interface WsConversationUpdated {
  id: string;
  status: string;
  assignedToId?: string;
  unreadCount: number;
  lastMessageAt?: string;
}

export interface WsCaseUpdated {
  id: string;
  status: string;
  priority: string;
  assigneeId?: string;
}
