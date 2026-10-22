'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { WalletStatus } from '@/hooks/useFanCoupons';

/** 狀態膠囊：可使用綠、即將到期紅、其餘灰（設計稿 (b) 狀態表） */
const STATUS_CLASS: Record<WalletStatus, string> = {
  AVAILABLE: 'bg-success-subtle text-success',
  EXPIRING: 'bg-destructive/15 text-destructive',
  NOT_YET: 'bg-muted text-muted-foreground',
  USED: 'bg-muted text-muted-foreground',
  EXPIRED: 'bg-muted text-muted-foreground',
  ENDED: 'bg-muted text-muted-foreground',
};

export function FanStatusBadge({ status, label, size = 'md' }: { status: WalletStatus; label: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold',
        size === 'sm' ? 'px-2 text-[10px] leading-5' : 'px-3 py-1 text-xs',
        STATUS_CLASS[status],
      )}
    >
      {label}
    </span>
  );
}
