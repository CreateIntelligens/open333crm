'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
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
      className="fixed inset-0 z-50 m-auto w-fit rounded-xl border border-border bg-background p-0 shadow-dropdown backdrop:bg-black/40"
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
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
    <div className={cn('flex flex-col gap-1 pb-5', className)}>
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
    <h2 className={cn('text-xl font-semibold leading-7 text-foreground', className)}>
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
    <div className={cn('flex flex-col-reverse gap-2.5 pt-5 sm:flex-row sm:justify-end', className)}>
      {children}
    </div>
  );
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter };
