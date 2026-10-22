'use client';

/**
 * 不可復原操作的確認框（提前結束、刪除、離開未儲存的編輯）。
 * 送出期間兩顆按鈕都停用，避免重複送出（UX 規則第 6 節）。
 */
import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** 危險操作的確認鈕用紅色 */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CouponConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent>
        <div role="alertdialog" aria-labelledby="coupon-confirm-title">
          <DialogHeader>
            <DialogTitle>
              <span id="coupon-confirm-title">{title}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">{description}</div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
