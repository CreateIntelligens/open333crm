'use client';

/**
 * 搜尋框與狀態分段控制。
 * 搜尋輸入以 debounce 送出，避免每打一個字就查一次；外部清空（例如「清除搜尋與篩選」）時同步輸入框。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CouponStatus, StatusCounts } from '@/hooks/useCoupons';

const SEARCH_DEBOUNCE_MS = 300;

const SEGMENTS: { value: CouponStatus | ''; label: string; countKey: keyof StatusCounts }[] = [
  { value: '', label: '全部', countKey: 'ALL' },
  { value: 'ACTIVE', label: '進行中', countKey: 'ACTIVE' },
  { value: 'PAUSED', label: '已暫停', countKey: 'PAUSED' },
  { value: 'DRAFT', label: '草稿', countKey: 'DRAFT' },
  { value: 'ENDED', label: '已結束', countKey: 'ENDED' },
];

interface Props {
  q: string;
  status: CouponStatus | '';
  counts: StatusCounts | undefined;
  onSearch: (q: string) => void;
  onStatusChange: (status: CouponStatus | '') => void;
}

export function CouponListToolbar({ q, status, counts, onSearch, onStatusChange }: Props) {
  const [input, setInput] = useState(q);
  // 只在使用者自己輸入時才送出 debounce，避免外部改 q 後又被舊輸入覆蓋
  const dirty = useRef(false);

  useEffect(() => {
    dirty.current = false;
    // 送出的是 trim 後的字；輸入框內容等價時不覆蓋，保留使用者正在打的尾端空白
    setInput((prev) => (prev.trim() === q.trim() ? prev : q));
  }, [q]);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      if (input.trim() !== q.trim()) onSearch(input.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, q, onSearch]);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative w-full lg:max-w-[420px]">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={input}
          aria-label="搜尋券名稱或券號"
          placeholder="搜尋券名稱或券號"
          onChange={(e) => {
            dirty.current = true;
            setInput(e.target.value);
          }}
          className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div
        role="group"
        aria-label="依狀態篩選"
        className="inline-flex w-fit max-w-full overflow-x-auto rounded-lg border border-border bg-muted/60 p-1"
      >
        {SEGMENTS.map((seg) => {
          const active = status === seg.value;
          return (
            <button
              key={seg.label}
              type="button"
              aria-pressed={active}
              onClick={() => onStatusChange(seg.value)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-background font-semibold text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {seg.label}
              <span className="font-mono text-xs text-muted-foreground"> {counts ? counts[seg.countKey] : '–'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
