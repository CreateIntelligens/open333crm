'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface TopbarProps {
  /** Page title shown on the left of the toolbar */
  title?: string;
  /** Right-side actions / search / tabs */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Page-level toolbar (sub-header) shown beneath the global LayoutTopbar.
 * Use this on each page to expose page title + page-specific actions (search, create button, etc.).
 *
 * The brand chip + connection status + notifications + user dropdown live in `LayoutTopbar`,
 * which is mounted once in the dashboard layout.
 */
export function Topbar({ title, children, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center justify-between gap-4 border-b border-surface-line bg-white px-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {title && (
          <h1 className="truncate text-[18px] font-semibold leading-6 text-ink">{title}</h1>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {children}
      </div>
    </header>
  );
}
