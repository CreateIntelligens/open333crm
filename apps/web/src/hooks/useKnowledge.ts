'use client';

import useSWR from 'swr';
import api from '@/lib/api';

interface KnowledgeFilters {
  status?: string;
  category?: string;
  source?: string;
  tag?: string;
  q?: string;
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useKnowledge(filters: KnowledgeFilters = {}) {
  const { status, category, source, tag, q, page = 1, limit = 50 } = filters;

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (category) params.set('category', category);
  if (source) params.set('source', source);
  if (tag) params.set('tag', tag);
  if (q) params.set('q', q);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/knowledge?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    articles: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useSources() {
  const { data, error, isLoading } = useSWR('/knowledge/sources', fetcher);

  return {
    sources: (data?.data || []) as string[],
    isLoading,
    error,
  };
}

export function useCategories() {
  const { data, error, isLoading } = useSWR('/knowledge/categories', fetcher);

  return {
    categories: (data?.data || []) as string[],
    isLoading,
    error,
  };
}
