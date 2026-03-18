'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CasePriorityBadgeProps {
  priority: string;
  className?: string;
}

const priorityConfig: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-slate-100', text: 'text-slate-600', label: '低' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '中' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', label: '高' },
  urgent: { bg: 'bg-red-100', text: 'text-red-700', label: '緊急' },
  critical: { bg: 'bg-red-200', text: 'text-red-800', label: '嚴重' },
};

export function CasePriorityBadge({ priority, className }: CasePriorityBadgeProps) {
  const config = priorityConfig[priority.toLowerCase()] || {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    label: priority,
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
