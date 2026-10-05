'use client';

import useSWR from 'swr';
import api from '@/lib/api';
import { fetchAllPages } from '@/lib/fetch-all-pages';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

/**
 * SWR hook to fetch the list of automation rules.
 * 列表沒有分頁 UI，所以逐頁取回全部規則（原本只取第一頁 20 條，之後的規則看不到）。
 */
export function useAutomationRules() {
  const { data, error, isLoading, mutate } = useSWR(
    '/automation/rules',
    (url: string) => fetchAllPages((u, config) => api.get(u, config), url),
    { refreshInterval: 30000 }
  );

  return {
    rules: (data ?? []) as Array<{
      id: string;
      name: string;
      description?: string;
      trigger?: { type: string; keywords?: string[]; match_mode?: string };
      eventType?: string;
      /** 用來標示 workers 會整條略過的規則 */
      conditions?: unknown;
      /** 用來標示含系統尚未支援動作的規則（AUDIT AUTO-01） */
      actions?: unknown;
      isActive: boolean;
      stopOnMatch: boolean;
      priority: number;
      runCount?: number;
      lastRunAt?: string;
      createdAt: string;
    }>,
    isLoading,
    error,
    mutate,
  };
}

/**
 * SWR hook to fetch a single automation rule by ID.
 * Pass `null` to skip the request (useful for "new" rule flow).
 */
export function useAutomationRule(ruleId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    ruleId ? `/automation/rules/${ruleId}` : null,
    fetcher
  );

  return {
    rule: (data?.data ?? null) as {
      id: string;
      name: string;
      description: string;
      trigger: { type: string; keywords?: string[]; match_mode?: string };
      eventType?: string;
      priority: number;
      isActive: boolean;
      stopOnMatch: boolean;
      conditions: Record<string, unknown>;
      actions: Array<{ type: string; payload: Record<string, unknown> }>;
      runCount?: number;
      lastRunAt?: string;
      createdAt: string;
    } | null,
    isLoading,
    error,
    mutate,
  };
}
