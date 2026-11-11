'use client';

/**
 * 表單用的確認框外殼：role=alertdialog、aria-modal、Esc 關閉、Tab 焦點留在框內，
 * 關閉後把焦點還給開啟前的元件（通常是觸發的按鈕）。
 *
 * 不用 components/ui/dialog（原生 <dialog>）：原生 dialog 按 Esc 會自己關閉，
 * 送出期間（發布中）無法擋下，React 端的 open 狀態也會和畫面不一致。
 */
import React, { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 標題的語氣：失敗時用紅字 */
  tone?: 'default' | 'danger';
  /** 送出中：Esc 與點背景都不關閉 */
  busy?: boolean;
  onClose: () => void;
  /** 開啟時要聚焦的元素（data-autofocus）；沒有時聚焦第一個可聚焦元素 */
  children?: React.ReactNode;
  footer: React.ReactNode;
  className?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell({ open, title, description, tone = 'default', busy = false, onClose, children, footer, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  busyRef.current = busy;
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // 關閉後焦點還給觸發元件（元件仍在畫面上時）
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          'flex max-h-[calc(100vh-2rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border bg-background shadow-dropdown',
          className,
        )}
      >
        <div className={cn('px-6 pb-4 pt-6', children ? 'border-b' : '')}>
          <h2 id={titleId} className={cn('text-lg font-semibold', tone === 'danger' ? 'text-destructive' : 'text-foreground')}>
            {title}
          </h2>
          {description && (
            <p id={descId} className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {children && <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>}
        <div className={cn('flex flex-wrap justify-end gap-2 px-6 py-4', children ? 'border-t' : '')}>{footer}</div>
      </div>
    </div>
  );
}
