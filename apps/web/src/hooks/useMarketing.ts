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

/** 廣播列表在有發送中、或排程時間已到但還沒開始的廣播時，每隔多久重新載入 */
export const BROADCAST_REFRESH_MS = 5000;

/**
 * 是否要自動重新載入：有發送中的廣播，或已排程且排程時間已到（「立即發送」剛排入、正要開始）。
 * 排程在未來的不算，免得排程等待期間一直重新載入
 */
export function broadcastsNeedRefresh(
  rows: Array<{ status: string; scheduledAt?: string | null }> | undefined,
  now: number = Date.now(),
): boolean {
  return (rows ?? []).some(
    (b) => b.status === 'sending' || (b.status === 'scheduled' && !!b.scheduledAt && new Date(b.scheduledAt).getTime() <= now),
  );
}

export function useBroadcasts(campaignId?: string) {
  const params = new URLSearchParams();
  if (campaignId) params.set('campaignId', campaignId);

  const key = `/marketing/broadcasts?${params.toString()}`;
  // 發送完成或失敗就停止重新載入（spec coupon-management「發放紀錄與廣播列表在發送完成前自動更新」）
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: (latest) => (broadcastsNeedRefresh(latest?.data) ? BROADCAST_REFRESH_MS : 0),
  });

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
