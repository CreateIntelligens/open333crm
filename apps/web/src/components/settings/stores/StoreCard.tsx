"use client";

import React from "react";
import { format } from "date-fns";
import { MoreHorizontal, Pencil, Plus, Power, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { lockedUntilDate, type Store, type StoreAccount } from "./store-types";

export type AccountAction = "reset-password" | "force-logout" | "toggle-active" | "delete";

const MANAGE_HINT = "需主管權限";

export function StoreCard({
  store,
  canManage,
  pendingAccountIds,
  onRename,
  onToggleStore,
  onAddAccount,
  onPrintPoster,
  onToggleRedeem,
  onAccountAction,
}: {
  store: Store;
  canManage: boolean;
  /** 正在送出開關請求的帳號，避免連點 */
  pendingAccountIds: ReadonlySet<string>;
  onRename: () => void;
  onToggleStore: () => void;
  onAddAccount: () => void;
  onPrintPoster: () => void;
  onToggleRedeem: (account: StoreAccount) => void;
  onAccountAction: (account: StoreAccount, action: AccountAction) => void;
}) {
  const disabledTitle = canManage ? undefined : MANAGE_HINT;

  return (
    <section data-testid="store-card" className="rounded-xl border bg-card" aria-labelledby={`store-${store.id}-name`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`store-${store.id}-name`} className="truncate text-base font-semibold">
              {store.name}
            </h3>
            {store.isActive ? <Badge variant="success">營業中</Badge> : <Badge variant="secondary">已停業</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {store.isActive
              ? `${store.accounts.length} 個帳號`
              : "已停業：此門市的帳號都不能核銷"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="xs" onClick={onPrintPoster}>
            <Printer /> 列印櫃檯海報
          </Button>
          <Button variant="ghost" size="xs" onClick={onRename} disabled={!canManage} title={disabledTitle}>
            <Pencil /> 改名
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleStore}
            disabled={!canManage}
            title={disabledTitle}
            className={cn(store.isActive && "text-destructive hover:text-destructive")}
          >
            <Power /> {store.isActive ? "設為停業" : "恢復營業"}
          </Button>
        </div>
      </header>

      <div className="px-5 py-3">
        {store.accounts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">尚未建立帳號。建立帳號後，店員才能登入核銷台。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">帳號名稱</th>
                  <th scope="col" className="py-2 pr-3 font-medium">核銷權限</th>
                  <th scope="col" className="py-2 pr-3 font-medium">狀態</th>
                  <th scope="col" className="py-2 pr-3 font-medium">最後登入</th>
                  <th scope="col" className="py-2 text-right font-medium"><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {store.accounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    canManage={canManage}
                    pending={pendingAccountIds.has(account.id)}
                    onToggleRedeem={() => onToggleRedeem(account)}
                    onAction={(action) => onAccountAction(account, action)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3 pt-2">
          <Button variant="subtle" size="xs" onClick={onAddAccount} disabled={!canManage} title={disabledTitle}>
            <Plus /> 新增帳號
          </Button>
          {!canManage && <span className="text-xs text-muted-foreground">{MANAGE_HINT}</span>}
        </div>
      </div>
    </section>
  );
}

function AccountStatus({ account }: { account: StoreAccount }) {
  if (!account.isActive) return <Badge variant="secondary">停用</Badge>;
  const locked = lockedUntilDate(account);
  if (locked) return <Badge variant="warning">鎖定中至 {format(locked, "HH:mm")}</Badge>;
  return <Badge variant="success">啟用</Badge>;
}

function AccountRow({
  account,
  canManage,
  pending,
  onToggleRedeem,
  onAction,
}: {
  account: StoreAccount;
  canManage: boolean;
  pending: boolean;
  onToggleRedeem: () => void;
  onAction: (action: AccountAction) => void;
}) {
  const switchLabel = `${account.username} 核銷權限`;

  return (
    <tr className={cn(!account.isActive && "text-muted-foreground")}>
      <td className="py-2.5 pr-3 font-mono font-medium">{account.username}</td>
      <td className="py-2.5 pr-3">
        <button
          type="button"
          role="switch"
          aria-checked={account.canRedeem}
          aria-label={switchLabel}
          title={canManage ? undefined : MANAGE_HINT}
          disabled={!canManage || pending}
          onClick={onToggleRedeem}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            account.canRedeem ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
              account.canRedeem ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="ml-2 align-middle text-xs text-muted-foreground">{account.canRedeem ? "可核銷" : "不可核銷"}</span>
      </td>
      <td className="py-2.5 pr-3">
        <AccountStatus account={account} />
      </td>
      <td className="py-2.5 pr-3 text-muted-foreground">
        {account.lastLoginAt ? format(new Date(account.lastLoginAt), "yyyy/MM/dd HH:mm") : "尚未登入"}
      </td>
      <td className="py-2.5 text-right">
        {canManage ? (
          <DropdownMenu
            align="right"
            trigger={
              <span
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                aria-label={`${account.username} 帳號操作`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </span>
            }
          >
            <DropdownMenuItem onClick={() => onAction("reset-password")}>重設密碼</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("force-logout")}>強制登出</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("toggle-active")}>
              {account.isActive ? "停用帳號" : "啟用帳號"}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={() => onAction("delete")}>
              刪除帳號
            </DropdownMenuItem>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            title={MANAGE_HINT}
            aria-label={`${account.username} 帳號操作（${MANAGE_HINT}）`}
          >
            <MoreHorizontal />
          </Button>
        )}
      </td>
    </tr>
  );
}
