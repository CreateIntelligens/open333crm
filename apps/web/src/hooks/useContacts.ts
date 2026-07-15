'use client';

import useSWR from 'swr';
import api from '@/lib/api';

interface ContactFilters {
  q?: string;
  tagId?: string;
  channelType?: string;
  excludeChannelType?: string;
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useContacts(filters: ContactFilters = {}) {
  const { q, tagId, channelType, excludeChannelType, page = 1, limit = 20 } = filters;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (tagId) params.set('tagId', tagId);
  if (channelType) params.set('channelType', channelType);
  if (excludeChannelType) params.set('excludeChannelType', excludeChannelType);
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
