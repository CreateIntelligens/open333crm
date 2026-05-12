'use client';

import React from 'react';
import { useCaseStats } from '@/hooks/useCases';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number;
  accent: 'link' | 'red' | 'orange' | 'green';
}

const ACCENT_STYLE: Record<StatCardProps['accent'], { border: string; text: string }> = {
  link: { border: 'border-l-link', text: 'text-link' },
  red: { border: 'border-l-f-red-60', text: 'text-f-red-60' },
  orange: { border: 'border-l-f-orange-60', text: 'text-f-orange-60' },
  green: { border: 'border-l-f-green-60', text: 'text-f-green-60' },
};

function StatCard({ label, value, accent }: StatCardProps) {
  const a = ACCENT_STYLE[accent];
  return (
    <div
      className={cn(
        'flex flex-1 flex-col gap-1 rounded-card border border-surface-line border-l-4 bg-white p-4 shadow-sm',
        a.border,
      )}
    >
      <p className="text-[12px] font-medium leading-4 text-ink-subtle">{label}</p>
      <p className={cn('text-[24px] font-bold leading-7', a.text)}>{value}</p>
    </div>
  );
}

export function CaseDashboardStats() {
  const { stats } = useCaseStats();

  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard label="開啟中" value={stats.openCount} accent="link" />
      <StatCard label="SLA 違規" value={stats.breachedCount} accent="red" />
      <StatCard label="即將到期" value={stats.warningCount} accent="orange" />
      <StatCard label="今日解決" value={stats.resolvedTodayCount} accent="green" />
    </div>
  );
}
