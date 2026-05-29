'use client';

import useSWR from 'swr';
import api from '@/lib/api';

export interface KbFeedbackItem {
  id: string;
  articleId: string;
  messageId: string | null;
  userQuestion: string | null;
  botReply: string | null;
  confidence: number | null;
  rating: string;
  status: string;
  createdAt: string;
  article?: { id: string; title: string; externalDocId: string | null };
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

/** 各文章 open 回報數 map：{ [articleId]: count } */
export function useKbFeedbackCounts() {
  const { data, error, isLoading, mutate } = useSWR('/knowledge/feedback/counts', fetcher);
  return {
    counts: (data?.data ?? {}) as Record<string, number>,
    isLoading,
    error,
    mutate,
  };
}

/** 回報明細，可依 articleId / status 過濾 */
export function useKbFeedbackList(opts: { articleId?: string; status?: string } = {}) {
  const params = new URLSearchParams();
  if (opts.articleId) params.set('articleId', opts.articleId);
  if (opts.status) params.set('status', opts.status);
  const qs = params.toString();
  const key = `/knowledge/feedback${qs ? `?${qs}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);
  return {
    feedback: (data?.data ?? []) as KbFeedbackItem[],
    isLoading,
    error,
    mutate,
  };
}

export async function resolveKbFeedback(id: string): Promise<void> {
  await api.patch(`/knowledge/feedback/${id}/resolve`);
}
