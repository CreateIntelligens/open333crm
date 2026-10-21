'use client';

/**
 * 右側面板「已發優惠券」（add-coupon-system A11）：對話聯絡人收到的券，附面額、發送人、時間與狀態。
 * 發券成功後 ChatWindow 以 issuedCouponsKey 重新整理這裡。
 */
import React from 'react';
import useSWR from 'swr';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { faceText, ISSUED_STATUS_LABEL, issuedCouponsKey, mdhm, type IssuedCoupon, type IssuedStatus } from '@/lib/coupon/issue';

const STATUS_CLASS: Record<IssuedStatus, string> = {
  SENT: 'bg-primary-subtle text-primary',
  VIEWED: 'bg-success-subtle text-success',
  USED: 'bg-muted text-muted-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
  REVOKED: 'bg-muted text-muted-foreground',
};

export function IssuedCouponsSection({ conversationId }: { conversationId: string }) {
  const { data, error, isLoading, mutate } = useSWR<IssuedCoupon[]>(issuedCouponsKey(conversationId), (url: string) =>
    api.get(url).then((res) => res.data.data),
  );

  return (
    <section aria-labelledby="issued-coupons-title">
      <h4 id="issued-coupons-title" className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
        <span>已發優惠券</span>
        {data && data.length > 0 && <span>{data.length}</span>}
      </h4>
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive">
          <p>無法載入已發優惠券：{getApiErrorMessage(error, '請稍後重試')}</p>
          <Button variant="outline" size="sm" className="mt-2 h-7" onClick={() => void mutate()}>重試</Button>
        </div>
      ) : isLoading || !data ? (
        <p className="text-xs text-muted-foreground">載入中…</p>
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground">尚未發過優惠券</p>
      ) : (
        <ul className="space-y-2">
          {data.map((c) => (
            <li key={c.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{c.couponName}</p>
                <span className="shrink-0 text-sm font-semibold">{faceText(c)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  {[c.issuedByName ?? c.issuedSourceName, mdhm(c.issuedAt)].filter(Boolean).join(' · ')}
                </span>
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS_CLASS[c.status])}>
                  {ISSUED_STATUS_LABEL[c.status]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
