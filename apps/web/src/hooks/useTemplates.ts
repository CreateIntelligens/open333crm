'use client';

import useSWR from 'swr';
import api from '@/lib/api';

interface TemplateFilters {
  category?: string;
  channelType?: string;
  q?: string;
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useTemplates(filters: TemplateFilters = {}) {
  const { category, channelType, q, page = 1, limit = 50 } = filters;

  const params = new URLSearchParams();
  if (category) { params.set('category', category); }
  if (channelType) { params.set('channelType', channelType); }
  if (q) { params.set('q', q); }
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/marketing/templates?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    templates: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}
