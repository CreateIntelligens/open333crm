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

/**
 * 日期範圍 — 依 Claude Design「報表總覽」：快捷分段按鈕（單選）＋起訖日期。
 * 選快捷時帶入日期；手動改日期時取消快捷選中。
 * 日期清空或起日晚於迄日時不送出、顯示錯誤（原本清空日期會把 Invalid Date 往上傳，整頁當掉）。
 */
export function DateRangePicker({ from, to, onChange, className }: DateRangePickerProps) {
  const [activePreset, setActivePreset] = React.useState<number | null>(30);
  const [error, setError] = React.useState<string | null>(null);

  function handlePreset(days: number) {
    setActivePreset(days);
    setError(null);
    const now = new Date();
    const start = days === 0
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    onChange(start, now);
  }

  function handleDate(which: 'from' | 'to', value: string) {
    setActivePreset(null);
    // 以本地時區解析（G10，取自 main）；清空或不完整時維持原區間、顯示錯誤
    const d = parseLocalDate(value);
    if (!d) {
      setError('請輸入完整日期');
      return;
    }
    // 迄日要含當天整天
    if (which === 'to') d.setHours(23, 59, 59, 999);
    const nextFrom = which === 'from' ? d : from;
    const nextTo = which === 'to' ? d : to;
    if (nextFrom > nextTo) {
      setError('開始日期不能晚於結束日期');
      return;
    }
    setError(null);
    onChange(nextFrom, nextTo);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div role="radiogroup" aria-label="日期範圍" className="flex h-10 items-center gap-1 rounded-md border border-border bg-muted p-1">
        {PRESETS.map((p) => {
          const on = activePreset === p.days;
          return (
            <button
              key={p.days}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => handlePreset(p.days)}
              className={cn(
                'flex h-8 items-center rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'bg-primary font-semibold text-white' : 'text-foreground hover:bg-black/5',
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <label htmlFor="range-from" className="sr-only">開始日期</label>
        <input
          id="range-from"
          type="date"
          value={formatLocalDate(from)}
          onChange={(e) => handleDate('from', e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'range-error' : undefined}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:border-primary focus-visible:outline-none aria-[invalid=true]:border-destructive"
        />
        <span aria-hidden="true" className="text-muted-foreground">～</span>
        <label htmlFor="range-to" className="sr-only">結束日期</label>
        <input
          id="range-to"
          type="date"
          value={formatLocalDate(to)}
          onChange={(e) => handleDate('to', e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'range-error' : undefined}
          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:border-primary focus-visible:outline-none aria-[invalid=true]:border-destructive"
        />
      </div>
      {error && <span id="range-error" role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
