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
    setActivePreset(null);
    onChange(new Date(e.target.value), to);
  }

  function handleToChange(e: React.ChangeEvent<HTMLInputElement>) {
    setActivePreset(null);
    onChange(from, new Date(e.target.value));
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
          value={from.toISOString().slice(0, 10)}
          onChange={handleFromChange}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        />
        <span className="text-muted-foreground">~</span>
        <input
          type="date"
          value={to.toISOString().slice(0, 10)}
          onChange={handleToChange}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        />
      </div>
    </div>
  );
}
