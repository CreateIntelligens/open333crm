'use client';

import useSWR from 'swr';
import api from '@/lib/api';

export interface ContactTag {
  id: string;
  name: string;
  color: string;
  scope: string;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

/**
 * 取租戶的 CONTACT-scope 標籤（供素材 action「點擊後貼標」下拉用）。
 * SWR 快取，一頁多個 action editor 共用同一份、不重複打 API。
 */
export function useContactTags() {
  const { data, isLoading } = useSWR('/tags', fetcher);
  const tags: ContactTag[] = ((data?.data ?? []) as ContactTag[]).filter((t) => t.scope === 'CONTACT');
  return { tags, isLoading };
}
