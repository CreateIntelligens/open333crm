'use client';

import useSWR from 'swr';
import api from '@/lib/api';

interface ContactFilters {
  q?: string;
  tag?: string;
  channel?: string;
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useContacts(filters: ContactFilters = {}) {
  const { q, tag, channel, page = 1, limit = 50 } = filters;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (tag) params.set('tag', tag);
  if (channel) params.set('channel', channel);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/contacts?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    contacts: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}
