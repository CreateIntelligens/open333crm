'use client';

/**
 * 列表的系統狀態（《優惠券後台 UX 規則》第 5 節）：
 * 「沒有資料」與「沒有符合條件」用不同文案與按鈕；錯誤提供重試；無權限時說明原因。
 */
import React from 'react';
import { AlertTriangle, Lock, SearchX, TicketPercent } from 'lucide-react';
import { Button } from '@/components/ui/button';

function StateBlock({
  icon,
  title,
  description,
  action,
  tone = 'muted',
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: 'muted' | 'destructive';
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className={
          tone === 'destructive'
            ? 'mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive'
            : 'mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground'
        }
        aria-hidden="true"
      >
        {icon}
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CouponListEmpty({ createButton }: { createButton: React.ReactNode }) {
  return (
    <StateBlock
      icon={<TicketPercent className="h-6 w-6" />}
      title="還沒有優惠券"
      description="建立第一張優惠券，就能在客服對話、行銷活動或廣播中發放給顧客。"
      action={createButton}
    />
  );
}

export function CouponListNoMatch({ onClear }: { onClear: () => void }) {
  return (
    <StateBlock
      icon={<SearchX className="h-6 w-6" />}
      title="沒有符合條件的優惠券"
      description="試著調整搜尋關鍵字或狀態篩選"
      action={
        <Button variant="outline" onClick={onClear}>
          清除搜尋與篩選
        </Button>
      }
    />
  );
}

export function CouponListError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert">
      <StateBlock
        tone="destructive"
        icon={<AlertTriangle className="h-6 w-6" />}
        title="優惠券列表載入失敗"
        description="網路連線逾時，請確認網路後重試。"
        action={
          <Button variant="outline" onClick={onRetry}>
            重試
          </Button>
        }
      />
    </div>
  );
}

export function CouponListNoAccess({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-xl border bg-card">
      <StateBlock
        icon={<Lock className="h-6 w-6" />}
        title="你沒有查看此頁面的權限，請洽主管"
        action={
          <Button variant="outline" onClick={onBack}>
            返回
          </Button>
        }
      />
    </div>
  );
}

/** 載入中：6 列骨架，欄寬與正式表格一致，避免載入完成時版面跳動 */
export function CouponTableSkeleton() {
  return (
    <div aria-busy="true" aria-label="載入中" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="grid animate-pulse grid-cols-[minmax(240px,2fr)_100px_100px_90px_90px_minmax(160px,1fr)_170px_44px] items-center gap-4 border-b border-border px-5 py-4 last:border-b-0"
        >
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
          </div>
          <div className="h-5 w-16 rounded-md bg-muted" />
          <div className="h-5 w-14 rounded-full bg-muted" />
          <div className="ml-auto h-4 w-12 rounded bg-muted" />
          <div className="ml-auto h-4 w-12 rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-1.5 w-full rounded-full bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
          <div className="h-8 w-8 rounded-md bg-muted" />
        </div>
      ))}
    </div>
  );
}
