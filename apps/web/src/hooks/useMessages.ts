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
  const { page = 1, limit = 100 } = filters;
  const { socket } = useSocket();
  const [olderMessages, setOlderMessages] = useState<unknown[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const oldestRef = useRef<string | null>(null);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = conversationId
    ? `/conversations/${conversationId}/messages?${params.toString()}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  // Reset older messages when conversation changes
  useEffect(() => {
    setOlderMessages([]);
    setHasMore(true);
    oldestRef.current = null;
  }, [conversationId]);

  // Listen for new messages
  useEffect(() => {
    if (!socket || !conversationId) return;

    const handleNewMessage = (payload: { conversationId: string }) => {
      if (payload.conversationId === conversationId) {
        mutate();
      }
    };

    socket.on('message.new', handleNewMessage);

    return () => {
      socket.off('message.new', handleNewMessage);
    };
  }, [socket, conversationId, mutate]);

  // Load older messages (cursor-based)
  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMore) return;

    const currentMessages = data?.data || [];
    const allMessages = [...olderMessages, ...currentMessages];
    const oldest = allMessages.length > 0
      ? allMessages.reduce((min: { createdAt: string }, m: { createdAt: string }) =>
          new Date(m.createdAt) < new Date(min.createdAt) ? m : min
        )
      : null;

    if (!oldest || (oldest as { id?: string }).id === oldestRef.current) return;

    setLoadingOlder(true);
    try {
      const beforeDate = (oldest as { createdAt: string }).createdAt;
      const res = await api.get(`/conversations/${conversationId}/messages?limit=50&page=1`);
      const older = (res.data.data || []).filter(
        (m: { createdAt: string }) => new Date(m.createdAt) < new Date(beforeDate)
      );

      if (older.length === 0) {
        setHasMore(false);
      } else {
        setOlderMessages((prev) => [...older, ...prev]);
        oldestRef.current = (oldest as { id: string }).id;
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, data, olderMessages, loadingOlder, hasMore]);

  const sendMessage = useCallback(
    async (content: string, contentType: string = 'text') => {
      if (!conversationId) return;

      const body: { content: Record<string, unknown> | string; contentType: string } = {
        contentType,
        content: contentType === 'text' ? { text: content } : { url: content },
      };

      // Try to parse content as JSON for image/file types
      if (contentType !== 'text') {
        try {
          const parsed = JSON.parse(content);
          body.content = parsed;
        } catch {
          body.content = { url: content };
        }
      }

      const res = await api.post(`/conversations/${conversationId}/messages`, body);
      mutate();
      return res.data;
    },
    [conversationId, mutate]
  );

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
