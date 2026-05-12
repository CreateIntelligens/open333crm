'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CaseStatusBadgeProps {
  status: string;
  className?: string;
}

// Figma case-status colours
// Use direct hex for the IN_PROGRESS orange (#FFF0E4/#FF6E00) — sourced from CaseCard tag spec.
const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  OPEN: { bg: 'bg-surface-active', text: 'text-link', label: 'OPEN' },
  IN_PROGRESS: { bg: 'bg-[#FFF0E4]', text: 'text-[#FF6E00]', label: 'IN_PROGRESS' },
  PENDING: { bg: 'bg-f-orange-10', text: 'text-f-orange-80', label: 'PENDING' },
  ESCALATED: { bg: 'bg-f-red-10', text: 'text-f-red-80', label: 'ESCALATED' },
  RESOLVED: { bg: 'bg-f-green-10', text: 'text-f-green-80', label: 'RESOLVED' },
  CLOSED: { bg: 'bg-neutral-30', text: 'text-ink-subtle', label: 'CLOSED' },
};

export function CaseStatusBadge({ status, className }: CaseStatusBadgeProps) {
  // Normalize to uppercase for lookup
  const key = status.toUpperCase();
  const config = statusConfig[key] || {
    bg: 'bg-neutral-30',
    text: 'text-ink-subtle',
    label: status,
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
