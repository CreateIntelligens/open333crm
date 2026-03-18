'use client';

import useSWR from 'swr';
import api from '@/lib/api';

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

/**
 * SWR hook to fetch the list of automation rules.
 */
export function useAutomationRules() {
  const { data, error, isLoading, mutate } = useSWR(
    '/automation/rules',
    fetcher,
    { refreshInterval: 30000 }
  );

  return {
    rules: (data?.data ?? []) as Array<{
      id: string;
      name: string;
      description?: string;
      trigger?: { type: string; keywords?: string[]; match_mode?: string };
      triggerEvent?: string;
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
      triggerEvent?: string;
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
