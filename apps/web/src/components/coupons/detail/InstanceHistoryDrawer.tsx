'use client';

/**
 * 序號歷程側欄（UX 規則第 4 節；Jira CM-196 詳情頁第 7 項）。
 * 從右側滑出，role=dialog；Esc 或按遮罩關閉，關閉後由呼叫端把焦點還給原本那一列。
 * 時間軸四步：發放 → 領取 → 開啟 → 核銷；已發生用實心點，未發生用空心灰點。
 */
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CouponInstanceRow } from '@/hooks/useCoupons';
import { InstanceStatusBadge } from '@/components/coupons/CouponBadges';
import { formatDateTime } from '@/lib/coupon/labels';
import { issuedSourceLines, issuedViaLabel, redeemChannelLabel } from './detail-helpers';

interface Props {
  row: CouponInstanceRow;
  /** 共用碼的券：標題改為「領取紀錄 · 顧客」 */
  shared: boolean;
  onClose: () => void;
}

interface Step {
  title: string;
  at: string | null;
  detail: string;
}

function buildSteps(row: CouponInstanceRow): Step[] {
  const customer = row.contact?.displayName || '未命名顧客';
  const { primary } = issuedSourceLines(row);
  const method = issuedViaLabel(row.issuedVia) ?? primary;
  const source = row.issuedSourceName || primary;
  const issuedDetail = [`方式：${method}`, `來源：${source}`, row.issuedByName ? `座席：${row.issuedByName}` : null]
    .filter(Boolean)
    .join(' · ');
  return [
    { title: '發放', at: row.issuedAt, detail: issuedDetail },
    { title: '領取', at: row.claimedAt, detail: row.claimedAt ? `顧客 ${customer}` : '尚未領取' },
    { title: '開啟', at: row.openedAt, detail: row.openedAt ? `顧客 ${customer}` : '尚未開啟' },
    { title: '核銷', at: row.redeemedAt, detail: row.redeemedAt ? redeemChannelLabel(row.redeemChannel) : '尚未核銷' },
  ];
}

export function InstanceHistoryDrawer({ row, shared, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 先以 translate-x-full 掛上，下一個畫格再移入，產生滑出效果
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    // 焦點留在側欄內
    if (e.key === 'Tab' && panelRef.current) {
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const customer = row.contact?.displayName || null;
  const title = shared ? `領取紀錄 · ${customer ?? '尚未領取'}` : row.code;
  const steps = buildSteps(row);

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 bg-foreground/30 transition-opacity duration-200 motion-reduce:transition-none',
          entered ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="instance-history-title"
        className={cn(
          'absolute right-0 top-0 flex h-full w-full max-w-[400px] flex-col bg-background shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none',
          entered ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="instance-history-title" className={cn('break-all text-base font-semibold', !shared && 'font-mono')}>
              {title}
            </h2>
            <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
              <InstanceStatusBadge status={row.status} />
              <span>{row.claimedAt && customer ? customer : '尚未領取'}</span>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="關閉序號歷程"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">序號歷程</h3>
          <ol className="space-y-0">
            {steps.map((s, i) => {
              const done = Boolean(s.at);
              return (
                <li key={s.title} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < steps.length - 1 && (
                    <span aria-hidden="true" className="absolute left-[5px] top-4 h-[calc(100%-8px)] w-px bg-border" />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2',
                      done ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-background',
                    )}
                  />
                  <div className="min-w-0 text-sm">
                    <div className={cn('font-medium', done ? 'text-foreground' : 'text-muted-foreground')}>
                      {s.title}
                      <span className="sr-only">{done ? '（已完成）' : '（尚未發生）'}</span>
                    </div>
                    {done && <div className="mt-0.5 font-mono text-xs text-muted-foreground">{formatDateTime(s.at)}</div>}
                    <div className="mt-0.5 break-words text-xs text-muted-foreground">{s.detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
