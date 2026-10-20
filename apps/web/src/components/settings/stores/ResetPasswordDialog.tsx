"use client";

import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { PasswordField } from "./PasswordField";
import { generatePassword, validatePassword, type StoreAccount } from "./store-types";

/** 重設門市帳號密碼：輸入兩次，送出後所有裝置都要重新登入（後端 passwordVersion 加一）。 */
export function ResetPasswordDialog({
  account,
  onClose,
  onDone,
}: {
  account: StoreAccount | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      {account && <ResetForm key={account.id} account={account} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function ResetForm({ account, onClose, onDone }: { account: StoreAccount; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const passwordError = password || submitted ? validatePassword(password) : null;
  const confirmError =
    (confirmPassword || submitted) && confirmPassword !== password ? "兩次輸入的密碼不一致" : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (validatePassword(password) || confirmPassword !== password) return;
    setSaving(true);
    try {
      await api.post(`/stores/accounts/${account.id}/reset-password`, { password });
      onDone();
    } catch (err) {
      setError(getApiErrorMessage(err, "重設密碼失敗，請稍後重試"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>重設密碼</DialogTitle>
        <p className="text-sm text-muted-foreground">
          帳號 <span className="font-mono font-medium text-foreground">{account.username}</span>{" "}
          重設後，所有已登入的裝置都要用新密碼重新登入。
        </p>
      </DialogHeader>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <p role="alert" className="rounded-md bg-destructive-subtle p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <PasswordField
          label="新密碼"
          value={password}
          onChange={setPassword}
          error={passwordError}
          hint="至少 8 字"
          action={
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto px-0"
              onClick={() => {
                const next = generatePassword();
                setPassword(next);
                setConfirmPassword(next);
              }}
            >
              <KeyRound /> 產生隨機密碼
            </Button>
          }
        />
        <PasswordField label="再輸入一次新密碼" value={confirmPassword} onChange={setConfirmPassword} error={confirmError} />
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" loading={saving}>
            重設密碼
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
