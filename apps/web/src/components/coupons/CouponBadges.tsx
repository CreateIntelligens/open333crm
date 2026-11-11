'use client';

/**
 * 優惠券狀態與用途標籤。色彩依後台原型；使用 globals.css 的 success／warning token，深色模式自動切換。
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { CouponPurpose, CouponStatus, InstanceStatus } from '@/hooks/useCoupons';
import { INSTANCE_STATUS_LABEL, PURPOSE_LABEL, STATUS_LABEL } from '@/lib/coupon/labels';

const STATUS_CLASS: Record<CouponStatus, string> = {
  ACTIVE: 'bg-success-subtle text-success border-success/30',
  PAUSED: 'bg-warning-subtle text-warning border-warning/30',
  ENDED: 'bg-muted text-muted-foreground border-transparent',
  // 草稿用虛線框，與已發布的券一眼區分
  DRAFT: 'bg-background text-muted-foreground border-dashed border-border',
};

export function CouponStatusBadge({ status, className }: { status: CouponStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STATUS_CLASS[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const PURPOSE_CLASS: Record<CouponPurpose, string> = {
  SERVICE: 'bg-warning-subtle text-warning',
  MARKETING: 'bg-primary/10 text-primary',
};

export function CouponPurposeBadge({ purpose, className }: { purpose: CouponPurpose | null; className?: string }) {
  if (!purpose) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
        PURPOSE_CLASS[purpose],
        className,
      )}
    >
      {PURPOSE_LABEL[purpose]}
    </span>
  );
}

const INSTANCE_CLASS: Record<InstanceStatus, string> = {
  ISSUED: 'bg-muted text-muted-foreground',
  CLAIMED: 'bg-primary/10 text-primary',
  OPENED: 'bg-primary/10 text-primary',
  REDEEMED: 'bg-success-subtle text-success',
  EXPIRED: 'bg-muted text-muted-foreground',
  REVOKED: 'bg-destructive/10 text-destructive',
};

export function InstanceStatusBadge({ status }: { status: InstanceStatus }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', INSTANCE_CLASS[status])}>
      {INSTANCE_STATUS_LABEL[status]}
    </span>
  );
}
