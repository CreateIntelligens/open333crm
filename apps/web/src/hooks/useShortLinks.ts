'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';
import { fetchAllPages } from '@/lib/fetch-all-pages';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export interface ShortLink {
  id: string;
  slug: string;
  targetUrl: string;
  title?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  lineChannelId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  tagOnClick?: string | null;
  isActive: boolean;
  expiresAt?: string | null;
  totalClicks: number;
  uniqueClicks: number;
  createdAt: string;
}

export interface ClickLog {
  id: string;
  shortLinkId: string;
  contactId?: string | null;
  lineUid?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  createdAt: string;
}

export function useShortLinks(filters?: { isActive?: string; q?: string }) {
  const { socket } = useSocket();
  const params = new URLSearchParams();
  if (filters?.isActive) params.set('isActive', filters.isActive);
  if (filters?.q) params.set('q', filters.q);

  const key = `/shortlinks?${params.toString()}`;
  // 列表沒有分頁 UI：逐頁取回全部，以前只拿到前 20 筆（M13）
  const { data, error, isLoading, mutate } = useSWR(key, async (url: string) => ({
    // 回傳型別維持原本 SWR 的 any，呼叫端以各自的型別使用
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: await fetchAllPages<any>((u, config) => api.get(u, config), url),
  }));

  useEffect(() => {
    if (!socket) return;
    const handler = () => mutate();
    socket.on('link.stats.updated', handler);
    return () => {
      socket.off('link.stats.updated', handler);
    };
  }, [socket, mutate]);

  return {
    links: data?.data || [],
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
    if (!socket || !id) return;

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
