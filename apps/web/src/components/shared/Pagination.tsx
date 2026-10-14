'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function buildPageRange(page: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | 'ellipsis')[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) pages.push('ellipsis');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push('ellipsis');
  pages.push(totalPages);
  return pages;
}

export function Pagination({ page, totalPages, onPageChange, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = buildPageRange(page, totalPages);

  // 依 Figma「Pagination Item」(1787:18681)：40×40、圓角 8；目前頁白底＋#E2E8F0 框、16px 500 深字；其他頁 #707E93
  const item = 'flex h-10 min-w-10 items-center justify-center rounded-md px-2 text-base font-medium leading-6 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <nav aria-label="分頁" className={cn('flex items-center justify-center gap-1', className)}>
      <button
        type="button"
        aria-label="上一頁"
        className={cn(item, 'text-muted-foreground hover:bg-shell disabled:pointer-events-none disabled:opacity-40')}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e${i}`} className="flex h-10 w-10 items-center justify-center text-base text-muted-foreground" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(
              item,
              p === page ? 'border border-border bg-background text-foreground' : 'text-muted-foreground hover:bg-shell',
            )}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        aria-label="下一頁"
        className={cn(item, 'text-muted-foreground hover:bg-shell disabled:pointer-events-none disabled:opacity-40')}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </nav>
  );
}
