'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { FilterValues } from './FilterDrawer';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '進行中',
  BOT_HANDLED: 'Bot 處理中',
  AGENT_HANDLED: '等待客服',
  CLOSED: '已關閉',
};

const ASSIGNEE_LABELS: Record<string, string> = {
  mine: '我的對話',
  unassigned: '未指派',
};

interface FilterChipsProps {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
  resultCount?: number;
}

export function FilterChips({ filters, onChange, resultCount }: FilterChipsProps) {
  const hasFilters =
    filters.statuses.length > 0 || filters.channels.length > 0 || filters.assignee !== '';

  if (!hasFilters) return null;

  const removeStatus = (status: string) => {
    onChange({ ...filters, statuses: filters.statuses.filter((s) => s !== status) });
  };

  const removeChannel = (channel: string) => {
    onChange({ ...filters, channels: filters.channels.filter((c) => c !== channel) });
  };

  const removeAssignee = () => {
    onChange({ ...filters, assignee: '' });
  };

  return (
    <div className="px-4 pb-2">
      <div className="flex flex-wrap gap-1.5">
        {filters.statuses.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
          >
            {STATUS_LABELS[s] || s}
            <button onClick={() => removeStatus(s)} className="hover:text-blue-900">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {filters.channels.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700"
          >
            {c}
            <button onClick={() => removeChannel(c)} className="hover:text-green-900">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {filters.assignee && (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
            {ASSIGNEE_LABELS[filters.assignee] || '指定客服'}
            <button onClick={removeAssignee} className="hover:text-purple-900">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>
      {resultCount !== undefined && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          篩選結果：{resultCount} 個對話
        </p>
      )}
    </div>
  );
}
