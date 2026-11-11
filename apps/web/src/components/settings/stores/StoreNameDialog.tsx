"use client";

import React, { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** 新增門市與門市改名共用的名稱對話框。onSubmit 拋出的錯誤訊息顯示在欄位下方。 */
/** 門市名稱上限，與後端 store.routes.ts 一致 */
const STORE_NAME_MAX = 50;

export function StoreNameDialog({
  open,
  title,
  initialName,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialName: string;
  submitLabel: string;
  onClose: () => void;
  /** 失敗時回傳錯誤訊息，成功回傳 null。 */
  onSubmit: (name: string) => Promise<string | null>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {open && (
        <NameForm
          key={initialName}
          title={title}
          initialName={initialName}
          submitLabel={submitLabel}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  );
}

function NameForm({
  title,
  initialName,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initialName: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("請輸入門市名稱");
      return;
    }
    // 與後端上限一致（store.routes.ts）：超過時後端只回籠統的「輸入內容有誤」
    if (trimmed.length > STORE_NAME_MAX) {
      setError(`門市名稱最多 ${STORE_NAME_MAX} 個字`);
      return;
    }
    setSaving(true);
    setError(await onSubmit(trimmed));
    setSaving(false);
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            門市名稱
          </label>
          <Input
            id={id}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="例如 內湖門市"
            maxLength={STORE_NAME_MAX}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            className={cn(error && "border-destructive")}
          />
          {error && (
            <p id={`${id}-err`} className="text-xs text-destructive">
              {error}
            </p>
          )}
          <p className="text-xs text-muted-foreground">門市名稱會印在櫃檯海報與核銷台登入頁上。</p>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" loading={saving}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
