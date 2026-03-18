'use client';

import useSWR from 'swr';
import { useEffect } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/providers/SocketProvider';

interface CaseFilters {
  status?: string;
  priority?: string;
  assigneeId?: string;
  category?: string;
  slaStatus?: 'normal' | 'warning' | 'breached';
  sortBy?: 'slaDueAt' | 'priority' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

const fetcher = async (url: string) => {
  const res = await api.get(url);
  return res.data;
};

export function useCases(filters: CaseFilters = {}) {
  const {
    status, priority, assigneeId, category, slaStatus,
    sortBy, sortOrder, page = 1, limit = 20,
  } = filters;
  const { socket } = useSocket();

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (assigneeId) params.set('assigneeId', assigneeId);
  if (category) params.set('category', category);
  if (slaStatus) params.set('slaStatus', slaStatus);
  if (sortBy) params.set('sortBy', sortBy);
  if (sortOrder) params.set('sortOrder', sortOrder);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const key = `/cases?${params.toString()}`;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    refreshInterval: 30000,
  });

  useEffect(() => {
    if (!socket) return;

    const handleCaseUpdated = () => {
      mutate();
    };

    socket.on('case.updated', handleCaseUpdated);
    socket.on('case.created', handleCaseUpdated);

    return () => {
      socket.off('case.updated', handleCaseUpdated);
      socket.off('case.created', handleCaseUpdated);
    };
  }, [socket, mutate]);

  return {
    cases: data?.data || [],
    meta: data?.meta,
    isLoading,
    error,
    mutate,
  };
}

export function useCaseStats() {
  const { socket } = useSocket();

  const { data, error, isLoading, mutate } = useSWR('/cases/stats', fetcher, {
    refreshInterval: 30000,
  });

  useEffect(() => {
    if (!socket) return;

    const handler = () => mutate();
    socket.on('case.updated', handler);
    socket.on('case.created', handler);

    return () => {
      socket.off('case.updated', handler);
      socket.off('case.created', handler);
    };
  }, [socket, mutate]);

  return {
    stats: data?.data || { openCount: 0, breachedCount: 0, warningCount: 0, resolvedTodayCount: 0 },
    isLoading,
    error,
    mutate,
  };
}
