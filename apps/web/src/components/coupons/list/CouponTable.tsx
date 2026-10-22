'use client';

/**
 * 優惠券列表表格。整列可點（Enter／Space 也可開啟），最右欄是操作選單。
 * 表格最小寬 1160px，窄螢幕在外層橫向捲動。
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { CouponListItem } from '@/hooks/useCoupons';
import { CouponPurposeBadge, CouponStatusBadge } from '@/components/coupons/CouponBadges';
import { formatNumber, percent, validityText, VALIDITY_KIND } from '@/lib/coupon/labels';
import { CouponRowActions } from './CouponRowActions';
import type { RowActionKey } from './row-actions';

/** 欄寬依後台原型：券名稱 / 用途 / 狀態 / 已發放 / 已領取 / 核銷率 / 效期 / 操作 */
export const COUPON_TABLE_COLUMNS =
  'grid-cols-[minmax(220px,2fr)_90px_90px_80px_80px_minmax(150px,1fr)_150px_36px]';

const HEAD_CELL = 'px-0 text-xs font-medium text-muted-foreground';

/** 已發放、已領取為 0 時顯示「—」 */
function countText(n: number): string {
  return n ? formatNumber(n) : '—';
}

function RedeemRate({ coupon }: { coupon: CouponListItem }) {
  const { claimedCount, redeemedCount, status } = coupon;
  if (!claimedCount) {
    return (
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm text-muted-foreground">—</span>
          <span className="text-xs text-muted-foreground">尚未發放</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted" aria-hidden="true" />
      </div>
    );
  }
  const ratio = Math.min(1, redeemedCount / claimedCount);
  // 已暫停、已結束的券不再累積核銷，進度條改灰色
  const inactive = status === 'PAUSED' || status === 'ENDED';
  return (
    <div>
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="font-mono text-sm font-semibold text-foreground">{percent(redeemedCount, claimedCount)}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-mono">{formatNumber(redeemedCount)}</span> 張已核銷
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn('h-full rounded-full', inactive ? 'bg-muted-foreground/50' : 'bg-primary')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  coupons: CouponListItem[];
  canManage: boolean;
  onOpen: (coupon: CouponListItem) => void;
  onAction: (coupon: CouponListItem, key: RowActionKey) => void;
}

export function CouponTable({ coupons, canManage, onOpen, onAction }: Props) {
  return (
    <table className="w-full min-w-[1080px] border-collapse text-sm">
      <thead>
        <tr className={cn('grid items-center gap-4 border-b border-border bg-muted/40 px-5 py-3', COUPON_TABLE_COLUMNS)}>
          <th scope="col" className={cn(HEAD_CELL, 'text-left')}>券名稱 / 券號</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-left')}>用途</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-left')}>狀態</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-right')}>已發放</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-right')}>已領取</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-left')}>核銷率</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-left')}>效期</th>
          <th scope="col" className={cn(HEAD_CELL, 'text-center')}>
            <span className="sr-only">操作</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {coupons.map((c) => (
          <tr
            key={c.id}
            tabIndex={0}
            aria-label={`開啟「${c.name}」`}
            onClick={() => onOpen(c)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(c);
              }
            }}
            className={cn(
              'grid cursor-pointer items-center gap-4 border-b border-border px-5 py-3.5 transition-colors last:border-b-0 hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              COUPON_TABLE_COLUMNS,
            )}
          >
            <td className="min-w-0">
              <div className="truncate font-semibold text-foreground">{c.name}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{c.displayCode}</div>
            </td>
            <td>
              <CouponPurposeBadge purpose={c.purpose} />
            </td>
            <td>
              <CouponStatusBadge status={c.status} />
            </td>
            <td className="text-right font-mono text-foreground">{countText(c.issuedCount)}</td>
            <td className="text-right font-mono text-foreground">{countText(c.claimedCount)}</td>
            <td>
              <RedeemRate coupon={c} />
            </td>
            <td className="min-w-0">
              <div className="truncate text-foreground">{validityText(c)}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {c.validityMode ? VALIDITY_KIND[c.validityMode] : '尚未設定'}
              </div>
            </td>
            <td className="flex justify-center">
              <CouponRowActions
                name={c.name}
                status={c.status}
                canManage={canManage}
                onAction={(key) => onAction(c, key)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
