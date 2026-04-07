'use client';

import useSWR from 'swr';
import { useEffect, useCallback, useState, useRef } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';

interface MessageFilters {
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useMessages(conversationId: string | null, filters: MessageFilters = {}) {
  const { page = 1, limit = 50 } = filters;
  const { socket } = useSocket();
  const [olderMessages, setOlderMessages] = useState<unknown[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Tracks the next page to fetch when loading older messages (page=1 is newest with order=desc)
  const olderPageRef = useRef(1);
  // Deduplicates rapid mutate calls (e.g. sendMessage + socket message.new firing together)
  const lastMutateRef = useRef(0);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('order', 'desc');

  const key = conversationId
    ? `/conversations/${conversationId}/messages?${params.toString()}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  const debouncedMutate = useCallback(() => {
    const now = Date.now();
    if (now - lastMutateRef.current < 500) return;
    lastMutateRef.current = now;
    mutate();
  }, [mutate]);

  // Reset older messages when conversation changes
  useEffect(() => {
    setOlderMessages([]);
    setHasMore(true);
    olderPageRef.current = 1;
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

  // Load older messages using page-based pagination (order=desc, so higher pages = older)
  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore) return;

    setLoadingOlder(true);
    try {
      const nextPage = olderPageRef.current + 1;
      const res = await api.get(
        `/conversations/${conversationId}/messages?limit=${limit}&page=${nextPage}&order=desc`
      );
      const older = res.data.data || [];

      if (older.length === 0) {
        setHasMore(false);
      } else {
        setOlderMessages((prev) => [...older, ...prev]);
        olderPageRef.current = nextPage;
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, limit, loadingOlder, hasMore]);

  const sendMessage = useCallback(
    async (content: string, contentType: string = 'text') => {
      if (!conversationId) return;

      const body: { content: Record<string, unknown> | string; contentType: string } = {
        contentType,
        content: contentType === 'text' ? { text: content } : { url: content },
      };

      if (contentType !== 'text') {
        try {
          const parsed = JSON.parse(content);
          body.content = parsed;
        } catch {
          body.content = { url: content };
        }
      }

      const res = await api.post(`/conversations/${conversationId}/messages`, body);
      debouncedMutate();
      return res.data;
    },
    [conversationId, debouncedMutate]
  );

  // olderMessages are older pages (higher page numbers); data?.data is the latest page (page=1)
  // Both are in desc order from API; sort ascending for display in ChatWindow
  const allMessages = [...olderMessages, ...(data?.data || [])];

  return {
    messages: allMessages,
    meta: data?.meta,
    isLoading,
    loadingOlder,
    hasMore,
    loadOlder,
    error,
    mutate,
    sendMessage,
  };
}
