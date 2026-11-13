'use client';

/**
 * 廣播的結果。附券廣播（add-coupon-system design D29）：發券張數、依原因分列的跳過與失敗人數；
 * 一般群發（change fix-plain-broadcast-send-362）：成功、失敗、略過人數。
 * 兩者都列出失敗與跳過的收件人與原因（例如「素材已送達，優惠券訊息送不出」的人要另外處理）。
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  couponBroadcastReasonLabel,
  couponResultLines,
  plainResultLines,
  type CouponBroadcastSummary,
} from '@/lib/marketing/coupon-broadcast';

interface RecipientRow {
  contactId: string;
  displayName: string | null;
  deliveryStatus: string;
  reason: string | null;
}

interface ResultState {
  summary: CouponBroadcastSummary | null;
  /** 一般群發的人數（廣播列的 successCount、failedCount、skippedCount） */
  counts: { successCount?: number; failedCount?: number; skippedCount?: number };
  failed: RecipientRow[];
  failedTotal: number;
  skipped: RecipientRow[];
  skippedTotal: number;
}

const LIST_LIMIT = 50;

export function BroadcastCouponResult({ broadcastId }: { broadcastId: string }) {
  const [state, setState] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    const list = (status: string) => api.get(`/marketing/broadcasts/${broadcastId}/recipients?status=${status}&limit=${LIST_LIMIT}`);
    Promise.all([api.get(`/marketing/broadcasts/${broadcastId}`), list('failed'), list('skipped')])
      .then(([detail, failed, skipped]) => {
        if (cancelled) return;
        setState({
          summary: detail.data.data?.couponSummary ?? null,
          counts: detail.data.data ?? {},
          failed: failed.data.data ?? [],
          failedTotal: failed.data.meta?.total ?? 0,
          skipped: skipped.data.data ?? [],
          skippedTotal: skipped.data.meta?.total ?? 0,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err, '結果載入失敗，請稍後再試'));
      });
    return () => {
      cancelled = true;
    };
  }, [broadcastId]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!state) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="載入中" />
      </div>
    );
  }

  const lines = state.summary ? couponResultLines(state.summary) : plainResultLines(state.counts);
  return (
    <div className="space-y-4 text-sm">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {lines.map((l) => (
          <li
            key={`${l.kind}-${l.label}`}
            className={l.kind === 'failed' ? 'text-destructive' : l.kind === 'issued' ? 'text-success' : 'text-muted-foreground'}
          >
            {`${l.label} ${l.count}`}
          </li>
        ))}
      </ul>
      <RecipientList title="失敗" rows={state.failed} total={state.failedTotal} />
      <RecipientList title="跳過（沒有送出訊息）" rows={state.skipped} total={state.skippedTotal} />
    </div>
  );
}

function RecipientList({ title, rows, total }: { title: string; rows: RecipientRow[]; total: number }) {
  if (total === 0) return null;
  return (
    <section className="space-y-1">
      <h4 className="font-medium">{`${title} ${total} 人`}</h4>
      <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
        {rows.map((r) => (
          <li key={r.contactId} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span>{r.displayName || '（未命名）'}</span>
            <span className="text-xs text-muted-foreground">{couponBroadcastReasonLabel(r.reason)}</span>
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="text-xs text-muted-foreground">只列出前 {rows.length} 人</p>}
    </section>
  );
}
