'use client';

import useSWR from 'swr';
import { useCallback, useEffect } from 'react';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';

interface ConversationFilters {
  status?: string;
  channelType?: string;
  assigneeId?: string;
  unread?: boolean;
  closedAfter?: string;
  page?: number;
  limit?: number;
}

interface UseConversationsOptions {
  selectedId?: string | null;
}

interface LastMessage {
  id?: string;
  content: string | Record<string, unknown>;
  contentType?: string;
  createdAt: string;
  senderType?: string;
  direction?: string;
}

export interface ConversationRow {
  id: string;
  contact?: {
    id: string;
    name?: string;
    displayName?: string;
    avatar?: string;
    avatarUrl?: string;
  };
  channelType: string;
  lastMessage?: LastMessage | null;
  unreadCount?: number;
  status: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  assignedToId?: string | null;
  caseId?: string | null;
  csatScore?: number | null;
  lastMessageSentiment?: string;
}

interface ConversationsResponse {
  data: ConversationRow[];
  meta?: unknown;
}

interface SocketMessagePayload {
  id?: string;
  conversationId?: string;
  direction?: string;
  senderType?: string;
  contentType?: string;
  content?: string | Record<string, unknown>;
  createdAt?: string;
}

interface MessageNewPayload {
  conversationId: string;
  message?: SocketMessagePayload;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

function sortByUpdatedAtDesc(rows: ConversationRow[]) {
  return [...rows].sort((a, b) => getSortTime(b) - getSortTime(a));
}

function getSortTime(row: ConversationRow) {
  return new Date(
    row.updatedAt || row.lastMessageAt || row.lastMessage?.createdAt || 0,
  ).getTime();
}

function updateRows(
  current: ConversationsResponse | undefined,
  updater: (rows: ConversationRow[]) => ConversationRow[],
) {
  if (!current?.data) return current;

  return {
    ...current,
    data: sortByUpdatedAtDesc(updater(current.data)),
  };
}

function toLastMessage(message: SocketMessagePayload): LastMessage {
  return {
    id: message.id,
    content: message.content ?? '',
    contentType: message.contentType,
    createdAt: message.createdAt ?? new Date().toISOString(),
    senderType: message.senderType,
    direction: message.direction,
  };
}

function isInbound(message: SocketMessagePayload) {
  return message.direction === 'INBOUND' || message.senderType === 'CONTACT';
}

function shouldClearUnread(message: SocketMessagePayload) {
  return message.senderType === 'AGENT';
}

export function useConversations(
  filters: ConversationFilters = {},
  options: UseConversationsOptions = {},
) {
  const { status, channelType, assigneeId, unread, closedAfter, page = 1, limit = 50 } = filters;
  const selectedId = options.selectedId ?? null;
  const { socket } = useSocket();

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (channelType) params.set('channelType', channelType);
  if (assigneeId) params.set('assigneeId', assigneeId);
  if (unread) params.set('unread', 'true');
  if (closedAfter) params.set('closedAfter', closedAfter);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/conversations?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR<ConversationsResponse>(key, fetcher);

  const markConversationRead = useCallback(
    (conversationId: string) => {
      const now = new Date().toISOString();

      void mutate(
        (current) =>
          updateRows(current, (rows) =>
            rows.map((row) =>
              row.id === conversationId
                ? { ...row, unreadCount: 0, updatedAt: now }
                : row,
            ),
          ),
        { revalidate: false },
      );

      void api.post(`/conversations/${conversationId}/read`).catch(() => {
        void mutate();
      });
    },
    [mutate],
  );

  // Listen for real-time updates
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (payload: MessageNewPayload) => {
      const conversationId = payload?.conversationId;
      const message = payload?.message;
      if (!conversationId || !message) {
        void mutate();
        return;
      }

      const known = data?.data?.some((row) => row.id === conversationId) ?? false;
      if (!known) {
        void mutate();
        return;
      }

      const selected = selectedId === conversationId;
      const inbound = isInbound(message);
      if (selected && inbound) {
        void api.post(`/conversations/${conversationId}/read`).catch(() => {
          void mutate();
        });
      }

      const lastMessage = toLastMessage(message);
      const messageTime = lastMessage.createdAt;

      void mutate(
        (current) =>
          updateRows(current, (rows) =>
            rows.map((row) => {
              if (row.id !== conversationId) return row;

              return {
                ...row,
                lastMessage,
                lastMessageAt: messageTime,
                updatedAt: messageTime,
                unreadCount: inbound
                  ? selected
                    ? 0
                    : (row.unreadCount ?? 0) + 1
                  : shouldClearUnread(message)
                    ? 0
                    : row.unreadCount,
              };
            }),
          ),
        { revalidate: false },
      );
    };

    const handleConversationUpdated = (payload: ConversationUpdatedPayload) => {
      if (!payload?.id) {
        void mutate();
        return;
      }

      const known = data?.data?.some((row) => row.id === payload.id) ?? false;
      if (!known) {
        void mutate();
        return;
      }

      void mutate(
        (current) =>
          updateRows(current, (rows) =>
            rows.map((row) => {
              if (row.id !== payload.id) return row;

              return {
                ...row,
                status: payload.status ?? row.status,
                assignedToId:
                  payload.assignedToId !== undefined
                    ? payload.assignedToId
                    : row.assignedToId,
                unreadCount:
                  payload.unreadCount !== undefined
                    ? payload.unreadCount
                    : row.unreadCount,
                lastMessageAt:
                  payload.lastMessageAt !== undefined
                    ? payload.lastMessageAt
                    : row.lastMessageAt,
                updatedAt: payload.updatedAt ?? row.updatedAt,
              };
            }),
          ),
        { revalidate: false },
      );
    };

    socket.on('message.new', handleNewMessage);
    socket.on('conversation.updated', handleConversationUpdated);

    return () => {
      socket.off('message.new', handleNewMessage);
      socket.off('conversation.updated', handleConversationUpdated);
    };
  }, [socket, mutate, data?.data, selectedId]);

  return {
    conversations: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
    markConversationRead,
  };
}
