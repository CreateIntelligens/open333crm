'use client';

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

function buildParams(from?: Date, to?: Date, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', to.toISOString());
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return params.toString();
}

export function useOverviewStats(from?: Date, to?: Date) {
  const qs = buildParams(from, to);
  const { data, error, isLoading } = useSWR(`/analytics/overview?${qs}`, fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data, isLoading, error };
}

export function useMessageTrend(from?: Date, to?: Date, groupBy: string = 'day') {
  const qs = buildParams(from, to, { groupBy });
  const { data, error, isLoading } = useSWR(`/analytics/message-trend?${qs}`, fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data || [], isLoading, error };
}

export function useCaseAnalytics(from?: Date, to?: Date) {
  const qs = buildParams(from, to);
  const { data, error, isLoading } = useSWR(`/analytics/cases?${qs}`, fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data, isLoading, error };
}

export function useAgentPerformance(from?: Date, to?: Date) {
  const qs = buildParams(from, to);
  const { data, error, isLoading } = useSWR(`/analytics/agents?${qs}`, fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data || [], isLoading, error };
}

export function useChannelAnalytics(from?: Date, to?: Date) {
  const qs = buildParams(from, to);
  const { data, error, isLoading } = useSWR(`/analytics/channels?${qs}`, fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data, isLoading, error };
}

export function useContactAnalytics(from?: Date, to?: Date) {
  const qs = buildParams(from, to);
  const { data, error, isLoading } = useSWR(`/analytics/contacts?${qs}`, fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data, isLoading, error };
}

export function useMyPerformance() {
  const { data, error, isLoading } = useSWR('/analytics/my', fetcher, {
    refreshInterval: 60000,
  });
  return { data: data?.data, isLoading, error };
}
