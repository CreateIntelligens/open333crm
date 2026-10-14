'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * PageDialog — 「下一頁」式的建立／編輯表單（依 Claude Design 短連結稿）
 *
 * API 與 Dialog 相同（open / onOpenChange ＋ Content / Header / Title / Footer），
 * 把原本跳出視窗的表單改成蓋滿白色內容區的頁面：
 * - 側欄、頂部列保持不動，只換掉內容區，看起來就是進到下一頁
 * - 上方麵包屑：{section} > {parent}（可點回列表）> {標題}
 * - 按瀏覽器「上一頁」會回到列表
 * - 底部按鈕主要動作在左、取消在右
 *
 * 需要 dashboard layout 裡的 #page-dialog-root；找不到時（例如不在 dashboard 內）
 * 退回一般置中顯示，不會壞掉。
 */

interface Ctx {
  section?: string;
  parent?: string;
  close: () => void;
}
const PageDialogCtx = createContext<Ctx>({ close: () => {} });

interface PageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** 麵包屑第一層，例如「設定」 */
  section?: string;
  /** 麵包屑第二層（可點回列表），例如「標籤管理」 */
  parent?: string;
}

export const PAGE_DIALOG_ROOT_ID = 'page-dialog-root';

function PageDialog({ open, onOpenChange, children, section, parent }: PageDialogProps) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const poppedRef = useRef(false);
  const pendingBackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    setRoot(document.getElementById(PAGE_DIALOG_ROOT_ID));
  }, []);

  // 開啟時加一筆瀏覽紀錄，讓「上一頁」回到列表。
  // 沿用原本的 history.state（只多一個標記），不影響 Next.js 路由；
  // 關閉時延後一拍才退回，避免開發模式 effect 重跑時誤關。
  useEffect(() => {
    if (!open) return;
    poppedRef.current = false;
    if (pendingBackRef.current) {
      clearTimeout(pendingBackRef.current);
      pendingBackRef.current = null;
    } else if (!window.history.state?.__pageDialog) {
      window.history.pushState({ ...window.history.state, __pageDialog: true }, '');
    }
    const onPop = () => {
      if (window.history.state?.__pageDialog) return;
      poppedRef.current = true;
      onOpenChangeRef.current(false);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (poppedRef.current) return;
      pendingBackRef.current = setTimeout(() => {
        pendingBackRef.current = null;
        if (window.history.state?.__pageDialog) window.history.back();
      }, 0);
    };
  }, [open]);

  if (!open) return null;

  const page = (
    <PageDialogCtx.Provider value={{ section, parent, close: () => onOpenChange(false) }}>
      <div
        role="region"
        aria-label={parent ? `${parent}表單` : '表單'}
        className="absolute inset-0 z-20 overflow-y-auto bg-background lg:rounded-tl-3xl"
      >
        {children}
      </div>
    </PageDialogCtx.Provider>
  );

  if (!root) {
    return (
      <PageDialogCtx.Provider value={{ section, parent, close: () => onOpenChange(false) }}>
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background">{children}</div>
      </PageDialogCtx.Provider>
    );
  }
  return createPortal(page, root);
}

function PageDialogContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="px-8 pb-10 pt-7">
      {/* 原本 dialog 傳進來的寬度（max-w-lg 等）不套用，表單頁統一 620px */}
      <div className={cn('flex max-w-[620px] flex-col gap-6', className?.replace(/(^|\s)max-w-\S+/g, ' '))}>{children}</div>
    </div>
  );
}

function PageDialogHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-col gap-1', className)}>{children}</div>;
}

function PageDialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  const { section, parent, close } = useContext(PageDialogCtx);
  return (
    <>
      <nav aria-label="麵包屑" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs leading-4 text-muted-foreground">
        {section && (
          <>
            <span>{section}</span>
            <span aria-hidden="true">&gt;</span>
          </>
        )}
        <button type="button" onClick={close} className="text-primary hover:text-primary-hover">
          {parent ?? '返回列表'}
        </button>
        <span aria-hidden="true">&gt;</span>
        <span className="text-foreground" aria-current="page">{children}</span>
      </nav>
      <h1 className={cn('text-2xl font-bold leading-8 text-foreground', className)}>{children}</h1>
    </>
  );
}

function PageDialogDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-sm leading-5 text-muted-foreground', className)}>{children}</p>;
}

/** 底部按鈕列：原本 dialog 是「取消、儲存」由左到右，這裡反過來讓主要動作在最左邊 */
function PageDialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-row-reverse flex-wrap items-center justify-end gap-2.5 border-t border-border pt-5', className)}>
      {children}
    </div>
  );
}

export {
  PageDialog,
  PageDialogContent,
  PageDialogHeader,
  PageDialogTitle,
  PageDialogDescription,
  PageDialogFooter,
};
