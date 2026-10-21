'use client';

/**
 * 詳情頁六個指標卡（UX 規則第 4 節【PM】）：發送、開啟連結、領取、開封、核銷、核銷率。
 * 開啟連結為點擊歸因（design D21）：未驗證身分的顧客開啟也算。
 * 百分比取小數 1 位，分母為 0 時顯示 0.0%（labels.ts 的 percent()）。
 */
import React from 'react';
import type { CouponStats } from '@/hooks/useCoupons';
import { formatNumber, percent } from '@/lib/coupon/labels';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';

interface Props {
  stats: CouponStats | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

function Card({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div role="group" aria-label={label} className="rounded-[10px] border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

export function CouponStatCards({ stats, isLoading, error, onRetry }: Props) {
  if (error && !stats) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <span className="text-destructive">成效數據載入失敗：{getApiErrorMessage(error, '請稍後再試')}</span>
        <Button variant="outline" size="xs" onClick={onRetry}>
          重試
        </Button>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy="true" aria-label="成效數據載入中">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[98px] animate-pulse rounded-[10px] border border-border bg-muted" />
        ))}
      </div>
    );
  }

  const { issued, claimed, opened, redeemed, linkOpened } = stats;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Card label="發送" value={formatNumber(issued)} note="已發出的序號" />
      <Card label="開啟連結" value={formatNumber(linkOpened)} note={`點擊率 ${percent(linkOpened, issued)}`} />
      <Card label="領取" value={formatNumber(claimed)} note={`領取率 ${percent(claimed, issued)}`} />
      <Card label="開封" value={formatNumber(opened)} note={`開封率 ${percent(opened, claimed)}`} />
      <Card label="核銷" value={formatNumber(redeemed)} note="已在門市使用" />
      <Card label="核銷率" value={percent(redeemed, claimed)} note="核銷 ÷ 領取" />
    </div>
  );
}
