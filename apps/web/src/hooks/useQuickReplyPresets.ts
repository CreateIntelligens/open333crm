'use client';

import useSWR from 'swr';
import api from '@/lib/api';

export interface QuickReplyItem {
  label: string;
  text?: string;
}

export interface QuickReplyPreset {
  id: string;
  tenantId: string;
  name: string;
  items: QuickReplyItem[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePresetPayload {
  name: string;
  items: QuickReplyItem[];
}

export interface UpdatePresetPayload {
  name?: string;
  items?: QuickReplyItem[];
  isActive?: boolean;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useQuickReplyPresets() {
  const { data, error, isLoading, mutate } = useSWR('/line/quick-reply-presets', fetcher);
  return {
    presets: (data?.data ?? []) as QuickReplyPreset[],
    isLoading,
    error,
    mutate,
  };
}

export async function createQuickReplyPreset(
  payload: CreatePresetPayload,
): Promise<QuickReplyPreset> {
  const res = await api.post('/line/quick-reply-presets', payload);
  return res.data.data;
}

export async function updateQuickReplyPreset(
  id: string,
  payload: UpdatePresetPayload,
): Promise<QuickReplyPreset> {
  const res = await api.patch(`/line/quick-reply-presets/${id}`, payload);
  return res.data.data;
}

export async function deleteQuickReplyPreset(id: string): Promise<void> {
  await api.delete(`/line/quick-reply-presets/${id}`);
}
