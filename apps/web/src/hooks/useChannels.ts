'use client';

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useChannels() {
  const { data, error, isLoading, mutate } = useSWR('/channels', fetcher);

  return {
    channels: data?.data || [],
    isLoading,
    error,
    mutate,
  };
}
