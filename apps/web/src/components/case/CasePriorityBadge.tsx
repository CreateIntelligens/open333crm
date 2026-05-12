'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CasePriorityBadgeProps {
  priority: string;
  className?: string;
}

const priorityConfig: Record<string, { bg: string; text: string; label: string }> = {
  LOW: { bg: 'bg-neutral-30', text: 'text-ink-subtle', label: '低' },
  MEDIUM: { bg: 'bg-f-lime-10', text: 'text-f-lime-80', label: '中' },
  HIGH: { bg: 'bg-f-orange-10', text: 'text-f-orange-80', label: '高' },
  URGENT: { bg: 'bg-f-red-10', text: 'text-f-red-80', label: '緊急' },
  CRITICAL: { bg: 'bg-f-red-20', text: 'text-f-red-90', label: '嚴重' },
};

export function CasePriorityBadge({ priority, className }: CasePriorityBadgeProps) {
  const config = priorityConfig[priority.toUpperCase()] || {
    bg: 'bg-neutral-30',
    text: 'text-ink-subtle',
    label: priority,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-card px-2 py-0.5 text-[12px] font-semibold leading-5',
        config.bg,
        config.text,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
