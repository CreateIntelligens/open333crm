'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useShortLinks(filters?: { isActive?: string; q?: string }) {
  const { socket } = useSocket();
  const params = new URLSearchParams();
  if (filters?.isActive) { params.set('isActive', filters.isActive); }
  if (filters?.q) { params.set('q', filters.q); }

  const key = `/shortlinks?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  useEffect(() => {
    if (!socket) { return; }
    const handler = () => mutate();
    socket.on('link.stats.updated', handler);
    return () => {
      socket.off('link.stats.updated', handler);
    };
  }, [socket, mutate]);

  return {
    links: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useShortLink(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/shortlinks/${id}` : null,
    fetcher,
  );

  return {
    link: data?.data || null,
    isLoading,
    error,
    mutate,
  };
}

export function useClickStats(id: string | null) {
  const { socket } = useSocket();
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/shortlinks/${id}/stats` : null,
    fetcher,
  );

  useEffect(() => {
    if (!socket || !id) { return; }

    const handler = (payload: { shortLinkId: string }) => {
      if (payload.shortLinkId === id) {
        mutate();
      }
    };

    socket.on('link.stats.updated', handler);
    return () => {
      socket.off('link.stats.updated', handler);
    };
  }, [socket, id, mutate]);

  return {
    stats: data?.data || null,
    isLoading,
    error,
    mutate,
  };
}
