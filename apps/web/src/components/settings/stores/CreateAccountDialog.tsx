"use client";

import React, { useId, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { PasswordField } from "./PasswordField";
import {
  generatePassword,
  USERNAME_HINT,
  validatePassword,
  validateUsername,
  type Store,
  type StoreAccount,
} from "./store-types";

/**
 * 新增門市帳號。建立成功後切換成「交付」畫面：密碼只在此時顯示與複製，
 * 關閉後無法再查看（後端只存雜湊）。
 */
export function CreateAccountDialog({
  store,
  onClose,
  onCreated,
}: {
  store: Store | null;
  onClose: () => void;
  onCreated: (account: StoreAccount) => void;
}) {
  // 帳號建立後密碼只顯示這一次：Esc 與點遮罩不關閉，只能按「我已交給店長」關閉
  const [showingPassword, setShowingPassword] = useState(false);
  const close = () => {
    setShowingPassword(false);
    onClose();
  };
  return (
    <Dialog
      open={store !== null}
      onOpenChange={(open) => !open && close()}
      onRequestClose={showingPassword ? () => {} : undefined}
    >
      {/* key 讓每次開啟都是乾淨的表單，避免殘留上一個門市的密碼 */}
      {store && (
        <CreateAccountForm
          key={store.id}
          store={store}
          onClose={close}
          onCreated={(account) => {
            setShowingPassword(true);
            onCreated(account);
          }}
        />
      )}
    </Dialog>
  );
}

function CreateAccountForm({
  store,
  onClose,
  onCreated,
}: {
  store: Store;
  onClose: () => void;
  onCreated: (account: StoreAccount) => void;
}) {
  const usernameId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [canRedeem, setCanRedeem] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [usernameServerError, setUsernameServerError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [copyState, setCopyState] = useState<{ ok: boolean; message: string } | null>(null);

  // 有輸入就即時檢查格式；空白欄位等按下建立才提示，避免一打開就滿版紅字
  const usernameError =
    usernameServerError ?? (username || submitted ? validateUsername(username) : null);
  const passwordError = password || submitted ? validatePassword(password) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (validateUsername(username) || validatePassword(password)) return;
    setSaving(true);
    try {
      const res = await api.post<{ data: StoreAccount }>(`/stores/${store.id}/accounts`, {
        username,
        password,
        canRedeem,
      });
      onCreated(res.data.data);
      setCreated({ username, password });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message = getApiErrorMessage(err, "建立帳號失敗，請稍後重試");
      // 帳號名稱重複（全平台唯一）顯示在帳號欄位下方，其他錯誤顯示在表單上方
      if (status === 409) setUsernameServerError(message);
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ ok: true, message: `已複製${label}` });
    } catch {
      setCopyState({ ok: false, message: "無法存取剪貼簿，請手動選取文字複製" });
    }
  };

  if (created) {
    return (
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>帳號已建立</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="rounded-md border border-warning/30 bg-warning-subtle p-3 text-sm leading-6 text-warning">
            請把帳號密碼交給店長。密碼只在此時可以複製，關閉後無法再查看；忘記密碼只能重設。
          </p>
          <dl className="space-y-3 rounded-md border bg-muted/40 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">門市</dt>
                <dd className="mt-0.5 font-medium">{store.name}</dd>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">帳號名稱</dt>
                <dd className="mt-0.5 break-all font-mono font-semibold">{created.username}</dd>
              </div>
              <Button variant="ghost" size="xs" onClick={() => copy(created.username, "帳號名稱")}>
                <Copy /> 複製
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">密碼</dt>
                <dd className="mt-0.5 break-all font-mono font-semibold">{created.password}</dd>
              </div>
              <Button variant="ghost" size="xs" onClick={() => copy(created.password, "密碼")}>
                <Copy /> 複製
              </Button>
            </div>
          </dl>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              copy(`門市：${store.name}\n帳號：${created.username}\n密碼：${created.password}`, "帳號與密碼")
            }
          >
            <Copy /> 一次複製帳號與密碼
          </Button>
          {copyState && (
            <p
              role={copyState.ok ? "status" : "alert"}
              className={cn("text-xs", copyState.ok ? "text-muted-foreground" : "text-destructive")}
            >
              {copyState.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>我已交給店長，關閉</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>新增門市帳號</DialogTitle>
        <p className="text-sm text-muted-foreground">{store.name} 的店員共用這組帳號登入核銷台。</p>
      </DialogHeader>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError && (
          <p role="alert" className="rounded-md bg-destructive-subtle p-3 text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="space-y-1.5">
          <label htmlFor={usernameId} className="text-sm font-medium">
            帳號名稱
          </label>
          <Input
            id={usernameId}
            value={username}
            onChange={(e) => {
              // 自動轉小寫：店長常照門市英文名打大寫，直接幫忙轉，不讓他卡在格式錯誤
              setUsername(e.target.value.toLowerCase());
              setUsernameServerError(null);
            }}
            placeholder="例如 dt3c-neihu"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            aria-invalid={usernameError ? true : undefined}
            aria-describedby={`${usernameId}-msg`}
            className={cn("font-mono", usernameError && "border-destructive")}
          />
          <p
            id={`${usernameId}-msg`}
            className={cn("text-xs", usernameError ? "text-destructive" : "text-muted-foreground")}
          >
            {usernameError ?? `${USERNAME_HINT}。所有品牌的帳號名稱不可重複。`}
          </p>
        </div>
        <PasswordField
          label="密碼"
          value={password}
          onChange={setPassword}
          error={passwordError}
          hint="至少 8 字"
          action={
            <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setPassword(generatePassword())}>
              <KeyRound /> 產生隨機密碼
            </Button>
          }
        />
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox checked={canRedeem} onCheckedChange={setCanRedeem} className="mt-0.5" />
          <span>
            <span className="font-medium">可以核銷</span>
            <span className="block text-xs text-muted-foreground">關閉後此帳號只能登入，查到券也無法核銷。</span>
          </span>
        </label>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" loading={saving}>
            建立帳號
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
