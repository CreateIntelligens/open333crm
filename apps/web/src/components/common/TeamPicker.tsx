'use client';

import React from 'react';
import useSWR from 'swr';
import api from '@/lib/api';
import { Select } from '@/components/ui/select';

interface TeamOption {
  id: string;
  name: string;
  _count?: { members: number };
}

const fetcher = async (url: string) => (await api.get(url)).data;

export interface TeamPickerProps {
  value?: string | null;
  onChange: (teamId: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function TeamPicker({
  value,
  onChange,
  placeholder = '選擇團隊',
  className,
  disabled,
}: TeamPickerProps) {
  const { data, isLoading } = useSWR('/teams', fetcher);
  const teams: TeamOption[] = data?.data ?? [];

  return (
    <Select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading || teams.length === 0}
      className={className}
      placeholder={teams.length === 0 ? '沒有可用的團隊' : placeholder}
      options={teams.map((t) => ({
        value: t.id,
        label: t._count ? `${t.name}（${t._count.members} 人）` : t.name,
      }))}
    />
  );
}
