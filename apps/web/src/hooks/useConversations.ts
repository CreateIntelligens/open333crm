'use client';

import useSWRInfinite from 'swr/infinite';
import { useCallback, useEffect, useMemo } from 'react';
import type { ConversationUpdatedPayload } from '@open333crm/shared';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';

interface ConversationFilters {
  status?: string;
  channelType?: string;
  assigneeId?: string;
  unread?: boolean;
  closedAfter?: string;
  /** 後端搜尋：聯絡人名稱或訊息內容（#422） */
  search?: string;
  /** 每頁筆數，預設 50 */
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
  /** 送出失敗的紀錄靠 metadata.deliveryFailed 辨識，列表要據此標紅 */
  metadata?: Record<string, unknown>;
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
  /** 對話所屬渠道（API 已回傳）；同一租戶可能接多個 LINE OA／粉專 */
  channel?: { id: string; displayName: string; channelType: string } | null;
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

interface ConversationsMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ConversationsResponse {
  data: ConversationRow[];
  meta?: ConversationsMeta;
}

interface SocketMessagePayload {
  id?: string;
  conversationId?: string;
  direction?: string;
  senderType?: string;
  contentType?: string;
  content?: string | Record<string, unknown>;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

interface MessageNewPayload {
  conversationId: string;
  message?: SocketMessagePayload;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

function getSortTime(row: ConversationRow) {
  return new Date(
    row.updatedAt || row.lastMessageAt || row.lastMessage?.createdAt || 0,
  ).getTime();
}

/**
 * 把已載入的各頁合成一份列表：依 id 去重（保留第一次出現），依 updatedAt desc 排序。
 * offset 分頁期間有對話往前移時，下一頁會再出現同一段對話（design D2）。
 */
function mergePages(pages: ConversationsResponse[] | undefined): ConversationRow[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const rows: ConversationRow[] = [];
  for (const page of pages) {
    for (const row of page?.data ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows.sort((a, b) => getSortTime(b) - getSortTime(a));
}

/** 對每一頁套用同一個列更新；排序在 mergePages 統一做，跨頁移動也正確 */
function updatePages(
  pages: ConversationsResponse[] | undefined,
  updater: (row: ConversationRow) => ConversationRow,
) {
  if (!pages) return pages;
  return pages.map((page) => (page?.data ? { ...page, data: page.data.map(updater) } : page));
}

function toLastMessage(message: SocketMessagePayload): LastMessage {
  return {
    id: message.id,
    content: message.content ?? '',
    contentType: message.contentType,
    createdAt: message.createdAt ?? new Date().toISOString(),
    senderType: message.senderType,
    direction: message.direction,
    // 不帶的話，剛送出失敗的那則在列表上看不出來，要等重新整理才有
    metadata: message.metadata,
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
  const { status, channelType, assigneeId, unread, closedAfter, search, limit = 50 } = filters;
  const selectedId = options.selectedId ?? null;
  const { socket } = useSocket();

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (channelType) params.set('channelType', channelType);
  if (assigneeId) params.set('assigneeId', assigneeId);
  if (unread) params.set('unread', 'true');
  if (closedAfter) params.set('closedAfter', closedAfter);
  if (search) params.set('search', search);
  params.set('limit', String(limit));
  const baseQuery = params.toString();

  // 篩選或搜尋改變時 key 改變，SWR 從第 1 頁重新開始（design D1）
  const getKey = (index: number, previous: ConversationsResponse | null) => {
    if (previous?.meta && previous.meta.page >= previous.meta.totalPages) return null;
    return `/conversations?${baseQuery}&page=${index + 1}`;
  };

  const { data, error, isLoading, isValidating, mutate, size, setSize } =
    useSWRInfinite<ConversationsResponse>(getKey, fetcher, { revalidateFirstPage: false });

  const conversations = useMemo(() => mergePages(data), [data]);
  const lastPage = data?.[data.length - 1];
  const meta = data?.[0]?.meta;
  const hasMore = !!lastPage?.meta && lastPage.meta.page < lastPage.meta.totalPages;
  // 下一頁失敗時 data 少一頁、error 有值：不能一直當成「載入中」，否則按鈕永遠停用
  const pageMissing = size > 0 && !!data && typeof data[size - 1] === 'undefined';
  const isLoadingMore = pageMissing && !error;

  const loadMore = useCallback(() => {
    if (isLoadingMore) return;
    if (pageMissing) {
      // 上一次載入下一頁失敗：重新請求同一頁，不再往後加一頁
      void mutate();
      return;
    }
    if (!hasMore) return;
    void setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, pageMissing, mutate, setSize]);

  const markConversationRead = useCallback(
    (conversationId: string) => {
      const now = new Date().toISOString();

      void mutate(
        (current) =>
          updatePages(current, (row) =>
            row.id === conversationId ? { ...row, unreadCount: 0, updatedAt: now } : row,
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

    const isKnown = (conversationId: string) =>
      conversations.some((row) => row.id === conversationId);

    const handleNewMessage = (payload: MessageNewPayload) => {
      const conversationId = payload?.conversationId;
      const message = payload?.message;
      if (!conversationId || !message || !isKnown(conversationId)) {
        // 列表沒有這段對話（新對話或在未載入的頁）：重新載入已載入的各頁
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
          updatePages(current, (row) => {
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
        { revalidate: false },
      );
    };

    const handleConversationUpdated = (payload: ConversationUpdatedPayload) => {
      if (!payload?.id || !isKnown(payload.id)) {
        void mutate();
        return;
      }

      void mutate(
        (current) =>
          updatePages(current, (row) => {
            if (row.id !== payload.id) return row;

            return {
              ...row,
              status: payload.status ?? row.status,
              assignedToId:
                payload.assignedToId !== undefined ? payload.assignedToId : row.assignedToId,
              unreadCount:
                payload.unreadCount !== undefined ? payload.unreadCount : row.unreadCount,
              lastMessageAt:
                payload.lastMessageAt !== undefined ? payload.lastMessageAt : row.lastMessageAt,
              updatedAt: payload.updatedAt ?? row.updatedAt,
            };
          }),
        { revalidate: false },
      );
    };

    socket.on('message.new', handleNewMessage);
    socket.on('conversation.updated', handleConversationUpdated);

    return () => {
      socket.off('message.new', handleNewMessage);
      socket.off('conversation.updated', handleConversationUpdated);
    };
  }, [socket, mutate, conversations, selectedId]);

  return {
    conversations,
    meta,
    /** 後端符合條件的總數（不是已載入的筆數） */
    total: meta?.total,
    hasMore,
    isLoadingMore,
    isValidating,
    loadMore,
    isLoading,
    error,
    mutate,
    markConversationRead,
  };
}
