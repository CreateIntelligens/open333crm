'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * CaseStatusBadge — 對齊 Figma「Tag / CaseStatus」(1070:9047)
 * 語意色「淺底深字」、圓角 12px。
 */
interface CaseStatusBadgeProps {
  status: string;
  className?: string;
}

const statusConfig: Record<string, { className: string; label: string }> = {
  open: { className: 'bg-primary-subtle text-primary', label: '開啟' },
  in_progress: { className: 'bg-warning-subtle text-warning', label: '處理中' },
  pending: { className: 'bg-primary-subtle text-primary', label: '待處理' },
  escalated: { className: 'bg-destructive-subtle text-destructive', label: '已升級' },
  resolved: { className: 'bg-success-subtle text-success', label: '已解決' },
  closed: { className: 'bg-muted text-muted-foreground', label: '已關閉' },
};

export function CaseStatusBadge({ status, className }: CaseStatusBadgeProps) {
  const config = statusConfig[status] || {
    className: 'bg-muted text-muted-foreground',
    label: status,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
