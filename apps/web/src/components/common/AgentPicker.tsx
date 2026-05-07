'use client';

import React from 'react';
import useSWR from 'swr';
import api from '@/lib/api';
import { Select } from '@/components/ui/select';

interface AgentOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

const fetcher = async (url: string) => (await api.get(url)).data;

export interface AgentPickerProps {
  value?: string | null;
  onChange: (agentId: string) => void;
  /** Filter to only AGENT role (excludes ADMIN/SUPERVISOR). Default false. */
  agentOnly?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function AgentPicker({
  value,
  onChange,
  agentOnly = false,
  placeholder = '選擇成員',
  className,
  disabled,
}: AgentPickerProps) {
  const { data, isLoading } = useSWR('/agents', fetcher);
  const agents: AgentOption[] = (data?.data ?? []).filter(
    (a: AgentOption) => !agentOnly || a.role === 'AGENT',
  );

  return (
    <Select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || isLoading}
      className={className}
      placeholder={placeholder}
      options={agents.map((a) => ({
        value: a.id,
        label: `${a.name}（${a.role}）`,
      }))}
    />
  );
}
