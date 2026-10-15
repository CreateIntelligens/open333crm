'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface DateRangePickerProps {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
  className?: string;
}

const PRESETS = [
  { label: '今天', days: 0 },
  { label: '7 天', days: 7 },
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
] as const;

/**
 * 日期框的值（YYYY-MM-DD）以本地時區解析（G10）。
 * new Date('YYYY-MM-DD') 會當成 UTC 午夜，台灣時間的迄日只算到 08:00。
 */
function parseLocalDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 以本地日期顯示；無效日期顯示空白，不可丟出 RangeError 讓整頁崩潰 */
function formatLocalDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function DateRangePicker({ from, to, onChange, className }: DateRangePickerProps) {
  const [activePreset, setActivePreset] = React.useState<number | null>(30);

  function handlePreset(days: number) {
    setActivePreset(days);
    const now = new Date();
    const start = days === 0
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    onChange(start, now);
  }

  function handleFromChange(e: React.ChangeEvent<HTMLInputElement>) {
    const date = parseLocalDate(e.target.value);
    if (!date) return; // 清空日期框時維持原區間（G10）
    setActivePreset(null);
    onChange(date, to);
  }

  function handleToChange(e: React.ChangeEvent<HTMLInputElement>) {
    const date = parseLocalDate(e.target.value);
    if (!date) return;
    setActivePreset(null);
    // 迄日要含當天整天
    date.setHours(23, 59, 59, 999);
    onChange(from, date);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {PRESETS.map((p) => (
        <button
          key={p.days}
          onClick={() => handlePreset(p.days)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activePreset === p.days
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-accent',
          )}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1 text-sm">
        <input
          type="date"
          value={formatLocalDate(from)}
          onChange={handleFromChange}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        />
        <span className="text-muted-foreground">~</span>
        <input
          type="date"
          value={formatLocalDate(to)}
          onChange={handleToChange}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        />
      </div>
    </div>
  );
}
