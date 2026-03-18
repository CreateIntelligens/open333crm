'use client';

import useSWR from 'swr';
import { useEffect } from 'react';
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

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useConversations(filters: ConversationFilters = {}) {
  const { status, channelType, assigneeId, unread, closedAfter, page = 1, limit = 50 } = filters;
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

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: 30000,
  });

  // Listen for real-time updates
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = () => {
      mutate();
    };

    const handleConversationUpdated = () => {
      mutate();
    };

    socket.on('message.new', handleNewMessage);
    socket.on('conversation.updated', handleConversationUpdated);

    return () => {
      socket.off('message.new', handleNewMessage);
      socket.off('conversation.updated', handleConversationUpdated);
    };
  }, [socket, mutate]);

  return {
    conversations: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}
