"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  /** 回傳 Promise；失敗時由呼叫端顯示錯誤，對話框照樣關閉。 */
  onConfirm: () => Promise<void>;
}

/** 門市設定頁共用的確認對話框（取代瀏覽器原生 confirm，文案可完整呈現）。 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  const handleConfirm = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await request.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      {request && (
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-muted-foreground">{request.message}</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              variant={request.destructive ? "destructive" : "default"}
              onClick={handleConfirm}
              loading={busy}
            >
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
