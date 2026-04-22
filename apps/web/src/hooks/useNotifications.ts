'use client';

import useSWR from 'swr';
import { useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';

interface NotificationFilters {
  isRead?: boolean;
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useNotifications(filters: NotificationFilters = {}) {
  const { isRead, page = 1, limit = 20 } = filters;
  const { socket } = useSocket();

  const params = new URLSearchParams();
  if (isRead !== undefined) { params.set('isRead', String(isRead)); }
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/notifications?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: 60000,
  });

  useEffect(() => {
    if (!socket) { return; }

    const handleNew = () => {
      mutate();
    };

    socket.on('notification.new', handleNew);

    return () => {
      socket.off('notification.new', handleNew);
    };
  }, [socket, mutate]);

  return {
    notifications: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useUnreadCount() {
  const { socket } = useSocket();

  const { data, error, isLoading, mutate } = useSWR(
    '/notifications/unread-count',
    fetcher,
    { refreshInterval: 60000 },
  );

  useEffect(() => {
    if (!socket) { return; }

    const handleNew = () => {
      mutate();
    };

    socket.on('notification.new', handleNew);

    return () => {
      socket.off('notification.new', handleNew);
    };
  }, [socket, mutate]);

  return {
    count: data?.data?.count ?? 0,
    isLoading,
    error,
    mutate,
  };
}

export function useNotificationActions() {
  const markAsRead = useCallback(async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
  }, []);

  const markAllAsRead = useCallback(async () => {
    await api.post('/notifications/read-all');
  }, []);

  return { markAsRead, markAllAsRead };
}
