'use client';

/**
 * 優惠券頁面共用的底部提示。成功訊息不加勾勾、不放 emoji（專案慣例）；
 * 失敗訊息用紅底，讓使用者一眼知道沒有成功。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type ToastState = { type: 'ok' | 'error'; message: string } | null;

export function useCouponToast(durationMs = 3000) {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs]);

  const showOk = useCallback((message: string) => setToast({ type: 'ok', message }), []);
  const showError = useCallback((message: string) => setToast({ type: 'error', message }), []);

  return { toast, showOk, showError, clear: useCallback(() => setToast(null), []) };
}

export function CouponToast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-[10px] px-4 py-2.5 text-sm shadow-dropdown',
        toast.type === 'ok' ? 'bg-foreground text-background' : 'bg-destructive text-destructive-foreground',
      )}
    >
      {toast.message}
    </div>
  );
}
