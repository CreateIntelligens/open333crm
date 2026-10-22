'use client';

/**
 * 券詳情頁的發放紀錄（add-coupon-system design D31）：這張券的附券廣播與「發送給…」批次發放，
 * 依原因列出跳過與失敗人數。排程中或發送中時自動重新載入。沒有紀錄時不顯示。
 */
import React from 'react';
import { useCouponBatchIssues, type CouponBatchRecord } from '@/hooks/useCouponBatchIssue';
import {
  COUPON_BROADCAST_FAILURE_HINTS,
  couponResultLines,
  type CouponResultLine,
} from '@/lib/marketing/coupon-broadcast';
import { getApiErrorMessage } from '@/lib/api-error';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  scheduled: '排入發送',
  sending: '發送中',
  completed: '已完成',
  failed: '失敗',
  cancelled: '已取消',
};

const LINE_TONE: Record<CouponResultLine['kind'], string> = {
  issued: 'text-success',
  pending: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
  failed: 'text-destructive',
};

function Record({ r }: { r: CouponBatchRecord }) {
  const lines = couponResultLines(r.summary);
  const hint = r.failureCode ? COUPON_BROADCAST_FAILURE_HINTS[r.failureCode] : undefined;
  return (
    <li className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{r.name}</span>
        <span className={cn('text-xs', r.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
          {STATUS_LABELS[r.status] ?? r.status}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {r.couponIssuedVia === 'batch' ? '批次發放' : '廣播'}
        {r.couponIssuedByName ? `・發放者 ${r.couponIssuedByName}` : ''}
        {`・對象 ${r.totalCount} 人`}
      </p>
      {r.status === 'failed' && r.failureReason && <p className="text-xs text-destructive">{r.failureReason}</p>}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {(r.status === 'completed' || r.status === 'sending' || r.status === 'failed') && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {lines.map((l) => (
            <li key={`${l.kind}-${l.label}`} className={LINE_TONE[l.kind]}>{`${l.label} ${l.count}`}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CouponBatchHistory({ couponId }: { couponId: string }) {
  const { records, error } = useCouponBatchIssues(couponId);
  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {getApiErrorMessage(error, '發放紀錄載入失敗，請重新整理')}
      </p>
    );
  }
  if (records.length === 0) return null;
  return (
    <section aria-labelledby="coupon-batch-history-title" className="space-y-2">
      <h2 id="coupon-batch-history-title" className="text-sm font-semibold text-foreground">發放紀錄</h2>
      <ul className="space-y-2">
        {records.map((r) => (
          <Record key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}
