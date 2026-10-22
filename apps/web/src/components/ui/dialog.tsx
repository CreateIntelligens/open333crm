'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /**
   * 提供時，Esc 與點遮罩不直接關閉，改呼叫此函式，由呼叫端決定是否關閉
   * （例如填寫中先詢問是否放棄）。點遮罩一次即觸發。
   */
  onRequestClose?: () => void;
}

function Dialog({ open, onOpenChange, children, onRequestClose }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastClickTimeRef = useRef<number>(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-fit rounded-xl border bg-background p-0 shadow-dropdown backdrop:bg-black/50"
      onClose={() => onOpenChange(false)}
      onCancel={(e) => {
        if (!onRequestClose) return;
        e.preventDefault();
        onRequestClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && onRequestClose) {
          onRequestClose();
          return;
        }
        if (e.target === dialogRef.current) {
          const now = Date.now();
          if (now - lastClickTimeRef.current < 300) {
            onOpenChange(false);
          }
          lastClickTimeRef.current = now;
        }
      }}
    >
      {open && children}
    </dialog>
  );
}

function DialogContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('w-[calc(100vw-2rem)] max-w-lg p-6', className)}>
      {children}
    </div>
  );
}

function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col space-y-1.5 pb-4', className)}>
      {children}
    </div>
  );
}

function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)}>
      {children}
    </h2>
  );
}

function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4', className)}>
      {children}
    </div>
  );
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter };
