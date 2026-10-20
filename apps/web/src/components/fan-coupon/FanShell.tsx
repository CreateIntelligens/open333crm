'use client';

/**
 * 顧客票券頁的頁框：手機寬度置中、白色導覽列（左側關閉或返回、置中標題）。
 * 顧客多在 LINE 內建瀏覽器開啟，深色模式跟隨系統設定（globals.css 的 .dark 由 app/coupon/layout.tsx 套用）。
 */
import React from 'react';
import { ChevronLeft, X } from 'lucide-react';

interface Props {
  title: string;
  /** back：返回箭頭；close：關閉（×）；none：不顯示 */
  nav?: 'back' | 'close' | 'none';
  onNav?: () => void;
  children: React.ReactNode;
  /** 固定在畫面底部的按鈕區 */
  footer?: React.ReactNode;
}

export function FanShell({ title, nav = 'none', onNav, children, footer }: Props) {
  return (
    <div className="flex min-h-[100dvh] justify-center bg-muted">
      <div className="flex w-full max-w-[480px] flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background px-4">
          {nav !== 'none' ? (
            <button
              type="button"
              onClick={onNav}
              aria-label={nav === 'back' ? '返回' : '關閉'}
              className="-ml-1 rounded-md p-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {nav === 'back' ? <ChevronLeft className="h-5 w-5" /> : <X className="h-5 w-5" />}
            </button>
          ) : (
            <span className="w-7" />
          )}
          <h1 className="flex-1 text-center text-[17px] font-semibold text-foreground">{title}</h1>
          <span className="w-7" />
        </header>
        <main className="flex-1 px-5 py-5">{children}</main>
        {footer && (
          <div className="sticky bottom-0 border-t border-border bg-background px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 結果與空狀態（領取失敗、券夾空、核銷時間結束等）：圓形圖示＋標題＋說明 */
export function StatusMessage({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <div className="flex h-[75px] w-[75px] items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</div>
      <h2 className="mt-6 text-xl font-black text-foreground">{title}</h2>
      {description && <p className="mt-2 whitespace-pre-line text-sm font-medium text-muted-foreground">{description}</p>}
      {children && <div className="mt-8 flex w-full flex-col gap-3">{children}</div>}
    </div>
  );
}
