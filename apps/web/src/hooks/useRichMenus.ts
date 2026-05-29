'use client';

import useSWR from 'swr';
import api from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────────────

export type RichMenuActionType =
  | 'postback'
  | 'message'
  | 'uri'
  | 'datetimepicker'
  | 'richmenuswitch';

export interface RichMenuAction {
  type: RichMenuActionType;
  label?: string;
  data?: string;
  displayText?: string;
  text?: string;
  uri?: string;
  altUri?: { desktop?: string };
  mode?: 'date' | 'time' | 'datetime';
  initial?: string;
  min?: string;
  max?: string;
  richMenuAliasId?: string;
}

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: RichMenuAction;
}

export interface RichMenu {
  id: string;
  tenantId: string;
  channelId: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  selected: boolean;
  areas: RichMenuArea[];
  imageUrl: string;
  status: 'draft' | 'published' | 'error';
  lineRichMenuId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRichMenuPayload {
  channelId: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  selected?: boolean;
  areas: RichMenuArea[];
  imageUrl: string;
}

export interface UpdateRichMenuPayload {
  name?: string;
  chatBarText?: string;
  size?: { width: number; height: number };
  selected?: boolean;
  areas?: RichMenuArea[];
  imageUrl?: string;
}

// ─── Fetcher ───────────────────────────────────────────────────────────

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

// ─── Hooks ─────────────────────────────────────────────────────────────

/** 列出某 LINE channel 的所有 Rich Menu 草稿 */
export function useRichMenus(channelId: string | null) {
  const key = channelId ? `/line/rich-menus?channelId=${channelId}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);
  return {
    richMenus: (data?.data ?? []) as RichMenu[],
    isLoading,
    error,
    mutate,
  };
}

/** 取得單一 Rich Menu */
export function useRichMenu(id: string | null) {
  const key = id ? `/line/rich-menus/${id}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher);
  return {
    richMenu: (data?.data ?? null) as RichMenu | null,
    isLoading,
    error,
    mutate,
  };
}

// ─── CRUD helpers ──────────────────────────────────────────────────────

export async function createRichMenu(payload: CreateRichMenuPayload): Promise<RichMenu> {
  const res = await api.post('/line/rich-menus', payload);
  return res.data.data;
}

export async function updateRichMenu(id: string, payload: UpdateRichMenuPayload): Promise<RichMenu> {
  const res = await api.patch(`/line/rich-menus/${id}`, payload);
  return res.data.data;
}

export async function deleteRichMenu(id: string): Promise<void> {
  await api.delete(`/line/rich-menus/${id}`);
}

export async function duplicateRichMenu(id: string): Promise<RichMenu> {
  const res = await api.post(`/line/rich-menus/${id}/duplicate`);
  return res.data.data;
}

export async function publishRichMenu(id: string): Promise<RichMenu> {
  const res = await api.post(`/line/rich-menus/${id}/publish`);
  return res.data.data;
}

export async function unpublishRichMenu(id: string): Promise<RichMenu> {
  const res = await api.post(`/line/rich-menus/${id}/unpublish`);
  return res.data.data;
}
