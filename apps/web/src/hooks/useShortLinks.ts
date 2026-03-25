'use client';

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useShortLinks(filters?: { isActive?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters?.isActive) params.set('isActive', filters.isActive);
  if (filters?.q) params.set('q', filters.q);

  const key = `/shortlinks?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

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
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/shortlinks/${id}/stats` : null,
    fetcher,
  );

  return {
    stats: data?.data || null,
    isLoading,
    error,
    mutate,
  };
}
