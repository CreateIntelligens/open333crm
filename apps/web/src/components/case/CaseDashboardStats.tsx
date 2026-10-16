'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Clock } from 'lucide-react';
import { useCaseStats } from '@/hooks/useCases';
import { cn } from '@/lib/utils';

export type CaseStatKey = 'open' | 'breached' | 'warning' | 'resolvedToday';

/**
 * 統計卡 — 版面依 Claude Design「工單管理」：可點擊的卡片，點了就套用對應篩選
 * （SLA 違規 → SLA 篩選「違規」、即將到期 → 「即將到期」、開啟中 → 清除 SLA 篩選）。
 * 顏色用 token；依 Figma 微調
 */
const CARDS: Array<{ key: CaseStatKey; label: string; icon: React.ElementType; tone: string; iconBg: string }> = [
  { key: 'open', label: '開啟中', icon: ClipboardList, tone: 'text-primary', iconBg: 'bg-primary-subtle text-primary' },
  { key: 'breached', label: 'SLA 違規', icon: AlertTriangle, tone: 'text-destructive', iconBg: 'bg-destructive-subtle text-destructive' },
  { key: 'warning', label: '即將到期', icon: Clock, tone: 'text-amber-700', iconBg: 'bg-orange-50 text-amber-700' },
  { key: 'resolvedToday', label: '今日解決', icon: CheckCircle2, tone: 'text-success', iconBg: 'bg-success-subtle text-success' },
];

interface CaseDashboardStatsProps {
  active?: CaseStatKey | null;
  onSelect?: (key: CaseStatKey) => void;
}

export function CaseDashboardStats({ active, onSelect }: CaseDashboardStatsProps) {
  const { stats } = useCaseStats();
  const values: Record<CaseStatKey, number> = {
    open: stats.openCount ?? 0,
    breached: stats.breachedCount ?? 0,
    warning: stats.warningCount ?? 0,
    resolvedToday: stats.resolvedTodayCount ?? 0,
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
      {CARDS.map(({ key, label, icon: Icon, tone, iconBg }) => {
        const on = active === key;
        const value = values[key];
        const clickable = Boolean(onSelect) && key !== 'resolvedToday';
        const body = (
          <>
            <span className="flex items-center gap-2">
              <span className={cn('flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px]', iconBg)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium text-muted-foreground">{label}</span>
            </span>
            <span className="flex items-baseline gap-1">
              <span className={cn('font-mono text-2xl font-semibold tabular-nums', value ? tone : 'text-foreground')}>{value}</span>
              <span className="text-xs text-muted-foreground">張</span>
            </span>
          </>
        );
        const cls = cn(
          'flex flex-col items-start gap-2 rounded-lg border bg-background px-4 py-3.5 text-left transition-colors',
          on ? 'border-primary ring-1 ring-primary' : 'border-border',
        );
        return clickable ? (
          <button
            key={key}
            type="button"
            onClick={() => onSelect?.(key)}
            aria-pressed={on}
            className={cn(cls, 'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            {body}
          </button>
        ) : (
          <div key={key} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}
