'use client';

import useSWR from 'swr';
import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';
import { createTrailingThrottle } from '@/lib/trailing-throttle';
import { getApiErrorMessage } from '@/lib/api-error';

interface MessageFilters {
  limit?: number;
}

interface MessagePageMeta {
  hasMore?: boolean;
  nextCursor?: string | null;
}

/** API 回傳的訊息；這裡只依 id 合併，其他欄位由顯示端解讀 */
interface MessageLike {
  id: string;
  createdAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

/** 依 id 合併多份訊息，同一則只留一份（先出現的優先） */
function mergeById<T extends MessageLike>(...lists: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const list of lists) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
  }
  return merged;
}

/**
 * 對話訊息：SWR 抓最新一頁，更早的頁由 loadOlder() 以游標 before 往前取（change fix-chat-window-load-older-468）。
 * 最新一頁因新訊息重新抓取時，被擠出最新一頁的訊息仍留在回傳的訊息裡，已載入範圍不會出現缺口（design D4）。
 */
export function useMessages(conversationId: string | null, filters: MessageFilters = {}) {
  const { limit = 50 } = filters;
  const { socket } = useSocket();
  const [olderMessages, setOlderMessages] = useState<MessageLike[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  // undefined：還沒載入過更早的頁，游標用最新一頁的 nextCursor；null：已經沒有更早的訊息
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const loadingOlderRef = useRef(false);

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('order', 'desc');

  const key = conversationId
    ? `/conversations/${conversationId}/messages?${params.toString()}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher);
  const latest: MessageLike[] = useMemo(() => data?.data || [], [data]);
  const latestMeta: MessagePageMeta | undefined = data?.meta;

  // 合併短時間內的多次重新抓取（例如 sendMessage 與 socket message.new 同時發生）。
  // 間隔內的最後一次不能丟：媒體下載完成的 message.new 常在 500 ms 內抵達（issue #206）
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const debouncedMutate = useMemo(() => createTrailingThrottle(() => mutateRef.current(), 500), []);
  useEffect(() => () => debouncedMutate.cancel(), [debouncedMutate]);

  // Reset older messages when conversation changes
  useEffect(() => {
    setOlderMessages([]);
    setOlderCursor(undefined);
    setOlderError(null);
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [conversationId]);

  // Listen for new messages via WebSocket
  useEffect(() => {
    if (!socket || !conversationId) return;

    const handleNewMessage = (payload: { conversationId: string }) => {
      if (payload.conversationId === conversationId) {
        debouncedMutate();
      }
    };

    socket.on('message.new', handleNewMessage);

    return () => {
      socket.off('message.new', handleNewMessage);
    };
  }, [socket, conversationId, debouncedMutate]);

  const cursor = olderCursor === undefined ? latestMeta?.nextCursor ?? null : olderCursor;
  const hasMore = Boolean(cursor);

  // 以游標往前取一頁；失敗時記下原因，重試用同一個游標。回傳是否取得更早的訊息
  const loadOlder = useCallback(async (): Promise<boolean> => {
    if (!conversationId || loadingOlderRef.current || !cursor) return false;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const res = await api.get(
        `/conversations/${conversationId}/messages?limit=${limit}&order=desc&before=${encodeURIComponent(cursor)}`
      );
      const older: MessageLike[] = res.data.data || [];
      const meta: MessagePageMeta | undefined = res.data.meta;
      setOlderMessages((prev) => mergeById(prev, older));
      setOlderCursor(meta?.nextCursor ?? null);
      return older.length > 0;
    } catch (err) {
      setOlderError(getApiErrorMessage(err, '請稍後重試'));
      return false;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, limit, cursor]);

  const sendMessage = useCallback(
    async (
      content: string,
      contentType: string = 'text',
      extraContent?: Record<string, unknown>,
      privacyMode?: 'mask' | 'original',
    ) => {
      if (!conversationId) return;

      const body: { content: Record<string, unknown> | string; contentType: string; privacyMode?: 'mask' | 'original' } = {
        contentType,
        content: contentType === 'text' ? { text: content } : { url: content },
        ...(contentType === 'text' && privacyMode ? { privacyMode } : {}),
      };

      if (contentType !== 'text') {
        try {
          const parsed = JSON.parse(content);
          body.content = parsed;
        } catch {
          body.content = { url: content };
        }
      }

      // Merge extra content fields (e.g. quickReplies)，由呼叫者決定塞什麼
      if (extraContent && typeof body.content === 'object' && body.content !== null) {
        body.content = { ...(body.content as Record<string, unknown>), ...extraContent };
      }

      const res = await api.post(`/conversations/${conversationId}/messages`, body);
      debouncedMutate();
      return res.data;
    },
    [conversationId, debouncedMutate]
  );

  // 這段對話出現過的最新一頁訊息都留著：新訊息把舊的擠出最新一頁時，畫面不出現缺口（design D4）。
  // 在 render 中同步累積（同一則重複加入沒有影響），不用 effect，避免先畫出少了訊息的一格
  const seenLatestRef = useRef<{ conversationId: string | null; byId: Map<string, MessageLike> }>({
    conversationId,
    byId: new Map(),
  });
  if (seenLatestRef.current.conversationId !== conversationId) {
    seenLatestRef.current = { conversationId, byId: new Map() };
  }
  for (const m of latest) seenLatestRef.current.byId.set(m.id, m);
  const seenLatest = seenLatestRef.current.byId;

  // 最新一頁與更早的頁都是由新到舊；ChatWindow 依時間排序顯示
  const allMessages = useMemo(
    () => mergeById(latest, olderMessages, [...seenLatest.values()]),
    // seenLatest 只在 latest 改變時增加，不必列為依賴
    [latest, olderMessages],
  );

  return {
    // 與修改前相同，回傳未定型別的訊息，欄位由 ChatWindow 解讀
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: allMessages as any[],
    meta: data?.meta,
    isLoading,
    loadingOlder,
    hasMore,
    loadOlder,
    olderError,
    error,
    mutate,
    sendMessage,
  };
}
