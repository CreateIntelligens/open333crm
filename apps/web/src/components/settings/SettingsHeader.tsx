'use client';

import React from 'react';
import { cn } from '@/lib/utils';

/**
 * 設定子頁的標題區 — 依 Claude Design 設定頁（標籤管理、SLA 政策、人員管理…）：
 * 頁面標題＋說明在左，主要操作按鈕在右。麵包屑由設定頁外層提供。
 */
export function SettingsHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-7 text-foreground">{title}</h1>
        {description && <p className="text-base text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

/** 分段式篩選（附數量）— 依 Claude Design：淺灰底、選中白底 */
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex h-10 w-fit flex-wrap items-center gap-1 rounded-md border border-border bg-muted p-1">
      {items.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-md px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
