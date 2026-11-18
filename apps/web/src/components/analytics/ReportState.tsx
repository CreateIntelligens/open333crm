'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

/** 報表區塊共用的狀態 — 依 Claude Design「報表總覽」：沒有資料、載入失敗＋重新載入 */
export function ReportEmpty({ className = 'py-12' }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 text-center ${className}`}>
      <span className="text-sm font-medium text-foreground">此期間沒有資料</span>
      <span className="text-xs text-muted-foreground">請切換日期範圍後再查看</span>
    </div>
  );
}

export function ReportError({ label, onRetry }: { label: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
      <span>{label}載入失敗，請稍後再試。</span>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>重新載入</Button>
      )}
    </div>
  );
}

/** 骨架列：載入中時取代內容，不用轉圈 */
export function Skeleton({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-muted ${className}`} />;
}

export const CARD = 'flex flex-col gap-4 rounded-lg border border-border bg-background p-5';
