'use client';

import useSWR from 'swr';
import api from '@/lib/api';
import { fetchAllPages } from '@/lib/fetch-all-pages';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

/**
 * 列表沒有分頁 UI：逐頁取回全部資料。以前只拿到後端預設的前 20 筆，
 * 第 21 筆以後在後台看不到也改不了（M13）。
 */
const allPagesFetcher = async (url: string) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: await fetchAllPages<any>((u, config) => api.get(u, config), url),
});

export function useActivities(filters?: { type?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.status) params.set('status', filters.status);

  const key = `/portal/activities?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, allPagesFetcher);

  return {
    activities: data?.data || [],
    isLoading,
    error,
    mutate,
  };
}

export function useActivity(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/portal/activities/${id}` : null,
    fetcher,
  );

  return {
    activity: data?.data || null,
    isLoading,
    error,
    mutate,
  };
}

export function useSubmissions(activityId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    activityId ? `/portal/activities/${activityId}/submissions` : null,
    allPagesFetcher,
  );

  return {
    submissions: data?.data || [],
    isLoading,
    error,
    mutate,
  };
}

export function usePoints(contactId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    contactId ? `/portal/points?contactId=${contactId}` : null,
    allPagesFetcher,
  );

  return {
    transactions: data?.data || [],
    isLoading,
    error,
    mutate,
  };
}

export function usePointBalance(contactId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    contactId ? `/portal/points/balance/${contactId}` : null,
    fetcher,
  );

  return {
    balance: data?.data?.balance ?? 0,
    isLoading,
    error,
    mutate,
  };
}
