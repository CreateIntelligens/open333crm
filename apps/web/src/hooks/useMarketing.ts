'use client';

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useCampaigns(status?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);

  const key = `/marketing/campaigns?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    campaigns: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useCampaign(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/marketing/campaigns/${id}` : null,
    fetcher,
  );

  return {
    campaign: data?.data || null,
    isLoading,
    error,
    mutate,
  };
}

export function useSegments() {
  const { data, error, isLoading, mutate } = useSWR('/marketing/segments', fetcher);

  return {
    segments: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useBroadcasts(campaignId?: string) {
  const params = new URLSearchParams();
  if (campaignId) params.set('campaignId', campaignId);

  const key = `/marketing/broadcasts?${params.toString()}`;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);

  return {
    broadcasts: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useBroadcast(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? `/marketing/broadcasts/${id}` : null,
    fetcher,
  );

  return {
    broadcast: data?.data || null,
    isLoading,
    error,
    mutate,
  };
}
