'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * CasePriorityBadge — 對齊 Figma「Tag / Priority」(1697:14324)
 * 帶前置色點、語意色、圓角 12px。
 */
interface CasePriorityBadgeProps {
  priority: string;
  className?: string;
}

const priorityConfig: Record<string, { className: string; dot: string; label: string }> = {
  low: { className: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground', label: '低' },
  medium: { className: 'bg-warning-subtle text-warning', dot: 'bg-warning', label: '中' },
  high: { className: 'bg-warning-subtle text-warning', dot: 'bg-warning', label: '高' },
  urgent: { className: 'bg-destructive-subtle text-destructive', dot: 'bg-destructive', label: '緊急' },
  critical: { className: 'bg-destructive-subtle text-destructive', dot: 'bg-destructive', label: '嚴重' },
};

export function CasePriorityBadge({ priority, className }: CasePriorityBadgeProps) {
  const config = priorityConfig[priority.toLowerCase()] || {
    className: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
    label: priority,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-xs font-semibold',
        config.className,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}
