'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CaseStatusBadgeProps {
  status: string;
  className?: string;
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-green-100', text: 'text-green-700', label: '開啟' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', label: '處理中' },
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待處理' },
  escalated: { bg: 'bg-orange-100', text: 'text-orange-700', label: '已升級' },
  resolved: { bg: 'bg-purple-100', text: 'text-purple-700', label: '已解決' },
  closed: { bg: 'bg-gray-100', text: 'text-gray-600', label: '已關閉' },
};

export function CaseStatusBadge({ status, className }: CaseStatusBadgeProps) {
  const config = statusConfig[status] || {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: status,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        config.bg,
        config.text,
        className
      )}
    >
      {config.label}
    </span>
  );
}
