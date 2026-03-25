'use client';

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useActivities(filters?: { type?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.type) params.set('type', filters.type);
  if (filters?.status) params.set('status', filters.status);

  const key = `/portal/activities?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    activities: data?.data || [],
    meta: data?.meta,
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
    fetcher,
  );

  return {
    submissions: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function usePoints(contactId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    contactId ? `/portal/points?contactId=${contactId}` : null,
    fetcher,
  );

  return {
    transactions: data?.data || [],
    meta: data?.meta,
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
