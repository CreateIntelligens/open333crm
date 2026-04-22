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
    if (!dialog) { return; }

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
      className="fixed inset-0 z-50 m-auto rounded-lg border bg-background p-0 shadow-lg backdrop:bg-black/50"
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
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onOpenChange(false);
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
    <div className={cn('w-full max-w-lg p-6', className)}>
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
