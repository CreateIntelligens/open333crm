'use client';

/**
 * 核銷台共用的版面元件：手機寬度頁框、置中導覽列、按鈕、明細列表。
 * 按鈕高 48、圓角 12（設計稿 Button Size=L）；顏色用 globals.css 的 token，深色模式可讀。
 */
import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-[100dvh] justify-center bg-muted', className)}>
      <div className="flex w-full max-w-[480px] flex-col">{children}</div>
    </div>
  );
}

export function TopBar({
  title,
  subtitle,
  onBack,
  backDisabled,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background px-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      ) : (
        <span className="w-10" />
      )}
      <h1 className="flex-1 truncate text-center text-[17px] font-semibold text-foreground">
        {title}
        {subtitle && <span className="ml-2 text-sm font-medium text-muted-foreground">· {subtitle}</span>}
      </h1>
      <span className="w-10" />
    </header>
  );
}

type Variant = 'primary' | 'outline';

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed',
        variant === 'primary' &&
          'bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-muted-foreground/30 disabled:text-muted-foreground',
        variant === 'outline' &&
          'border border-border bg-background text-foreground hover:bg-accent disabled:text-muted-foreground disabled:opacity-60',
        className,
      )}
    />
  );
}

export interface DetailRow {
  k: string;
  v: string;
  mono?: boolean;
}

/** 明細列表：左標籤、右值（序號與時間用等寬字） */
export function DetailList({ rows, className }: { rows: DetailRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <dl className={cn('divide-y divide-border', className)}>
      {rows.map((r) => (
        <div key={r.k} className="flex items-start justify-between gap-4 py-3">
          <dt className="shrink-0 text-sm font-medium text-muted-foreground">{r.k}</dt>
          <dd className={cn('min-w-0 break-all text-right text-sm font-semibold text-foreground', r.mono && 'font-mono tracking-wide')}>
            {r.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 錯誤說明（role=alert，畫面上看得到，不只寫 console） */
export function ErrorNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('rounded-xl bg-destructive-subtle px-4 py-3 text-sm font-medium text-destructive', className)}>
      {children}
    </p>
  );
}
