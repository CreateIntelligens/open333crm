'use client';

/**
 * 顧客票券頁的按鈕（設計稿 F.6）：高 48、圓角 12。
 * - primary：主要動作（查看此票券、前往驗證）
 * - secondary：淡藍底藍框（查看票券匣）
 * - subtle：白底灰框（回到 LINE）
 */
import React from 'react';
import { cn } from '@/lib/utils';

const VARIANT = {
  primary: 'bg-primary font-semibold text-primary-foreground hover:bg-primary-hover',
  secondary: 'border border-primary bg-primary-subtle font-medium text-primary',
  subtle: 'border border-border bg-background font-medium text-muted-foreground',
} as const;

export function FanButton({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANT }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-12 w-full items-center justify-center rounded-xl px-4 text-base transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60',
        VARIANT[variant],
        className,
      )}
    />
  );
}
