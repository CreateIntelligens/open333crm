"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadErrorNotice } from "@/components/shared/LoadErrorNotice";
import { CouponToast, useCouponToast } from "@/components/coupons/CouponToast";
import api from "@/lib/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { usePermission } from "@/providers/AuthProvider";
import { StoreCard, type AccountAction } from "./StoreCard";
import { StoreNameDialog } from "./StoreNameDialog";
import { CreateAccountDialog } from "./CreateAccountDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { StorePosterDialog } from "./StorePosterDialog";
import { ConfirmDialog, type ConfirmRequest } from "./ConfirmDialog";
import type { Store, StoreAccount } from "./store-types";

/**
 * 後台「門市與核銷帳號」（openspec add-coupon-system / store-redemption、design D13）。
 * 外層（settings page）已檢查 store.view；這裡只依 store.manage 決定異動按鈕是否停用。
 * 只有查看權限時按鈕停用並標示「需主管權限」，不隱藏，讓使用者知道功能存在。
 */
export function StoreManagement() {
  const canManage = usePermission("store.manage");
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showOk, showError } = useCouponToast(5000);

  const [nameDialog, setNameDialog] = useState<{ mode: "create" } | { mode: "rename"; store: Store } | null>(null);
  const [accountStore, setAccountStore] = useState<Store | null>(null);
  const [resetAccount, setResetAccount] = useState<StoreAccount | null>(null);
  const [posterStore, setPosterStore] = useState<Store | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [pendingAccountIds, setPendingAccountIds] = useState<ReadonlySet<string>>(new Set());

  const fetchStores = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await api.get<{ data: Store[] }>("/stores");
      setStores(res.data.data);
    } catch (err) {
      setLoadError(getApiErrorMessage(err, "請稍後重試"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  // 局部更新：PATCH 回來的資料直接換掉，不必整頁重抓
  const replaceStore = (storeId: string, patch: Partial<Store>) =>
    setStores((prev) => prev.map((s) => (s.id === storeId ? { ...s, ...patch } : s)));
  const replaceAccount = (account: StoreAccount) =>
    setStores((prev) =>
      prev.map((s) =>
        s.id === account.storeId ? { ...s, accounts: s.accounts.map((a) => (a.id === account.id ? { ...a, ...account } : a)) } : s,
      ),
    );

  const submitStoreName = async (name: string): Promise<string | null> => {
    if (!nameDialog) return null;
    try {
      if (nameDialog.mode === "create") {
        const res = await api.post<{ data: Store }>("/stores", { name });
        setStores((prev) => [...prev, { ...res.data.data, accounts: res.data.data.accounts ?? [] }]);
        showOk(`已新增門市「${name}」`);
      } else {
        const res = await api.patch<{ data: Store }>(`/stores/${nameDialog.store.id}`, { name });
        replaceStore(nameDialog.store.id, { name: res.data.data?.name ?? name });
        showOk("已更新門市名稱");
      }
      setNameDialog(null);
      return null;
    } catch (err) {
      return getApiErrorMessage(err, "儲存失敗，請稍後重試");
    }
  };

  const setStoreActive = async (store: Store, isActive: boolean) => {
    try {
      await api.patch(`/stores/${store.id}`, { isActive });
      replaceStore(store.id, { isActive });
      showOk(isActive ? `「${store.name}」已恢復營業` : `「${store.name}」已設為停業`);
    } catch (err) {
      showError(getApiErrorMessage(err, "更新門市狀態失敗"));
    }
  };

  const handleToggleStore = (store: Store) => {
    if (store.isActive) {
      setConfirm({
        title: `將「${store.name}」設為停業？`,
        message: "停業後此門市的所有帳號都不能核銷，已登入的裝置下一次操作就會被擋。",
        confirmLabel: "確定停業",
        destructive: true,
        onConfirm: () => setStoreActive(store, false),
      });
    } else {
      setStoreActive(store, true);
    }
  };

  const patchAccount = async (account: StoreAccount, body: Partial<Pick<StoreAccount, "canRedeem" | "isActive">>, okMessage: string) => {
    setPendingAccountIds((prev) => new Set(prev).add(account.id));
    try {
      const res = await api.patch<{ data: StoreAccount }>(`/stores/accounts/${account.id}`, body);
      replaceAccount({ ...account, ...body, ...(res.data?.data ?? {}) });
      showOk(okMessage);
    } catch (err) {
      showError(getApiErrorMessage(err, "更新帳號失敗"));
    } finally {
      setPendingAccountIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  };

  const handleAccountAction = (account: StoreAccount, action: AccountAction) => {
    switch (action) {
      case "reset-password":
        setResetAccount(account);
        return;
      case "force-logout":
        setConfirm({
          title: `強制登出 ${account.username}？`,
          message: "這個帳號在所有裝置都會被登出",
          confirmLabel: "強制登出",
          destructive: true,
          onConfirm: async () => {
            try {
              await api.post(`/stores/accounts/${account.id}/force-logout`);
              showOk(`已登出 ${account.username} 的所有裝置`);
            } catch (err) {
              showError(getApiErrorMessage(err, "強制登出失敗"));
            }
          },
        });
        return;
      case "toggle-active":
        if (account.isActive) {
          setConfirm({
            title: `停用 ${account.username}？`,
            message: "停用後這個帳號不能登入與核銷，已登入的裝置下一次操作就會被擋。之後可以再啟用。",
            confirmLabel: "停用帳號",
            destructive: true,
            onConfirm: () => patchAccount(account, { isActive: false }, `已停用 ${account.username}`),
          });
        } else {
          patchAccount(account, { isActive: true }, `已啟用 ${account.username}`);
        }
        return;
      case "delete":
        setConfirm({
          title: `刪除 ${account.username}？`,
          message: "刪除後無法復原，已登入的裝置會顯示找不到此門市帳號",
          confirmLabel: "刪除帳號",
          destructive: true,
          onConfirm: async () => {
            try {
              await api.delete(`/stores/accounts/${account.id}`);
              setStores((prev) =>
                prev.map((s) => (s.id === account.storeId ? { ...s, accounts: s.accounts.filter((a) => a.id !== account.id) } : s)),
              );
              showOk(`已刪除 ${account.username}`);
            } catch (err) {
              showError(getApiErrorMessage(err, "刪除帳號失敗"));
            }
          },
        });
        return;
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">門市與核銷帳號</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            每間門市可建立共用帳號給店員登入核銷台。把櫃檯海報印出來貼在門市，店員用手機掃描即可開啟登入頁。
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setNameDialog({ mode: "create" })} disabled={!canManage} title={canManage ? undefined : "需主管權限"}>
            <Plus /> 新增門市
          </Button>
          {!canManage && <span className="text-xs text-muted-foreground">你目前只能查看，新增與異動需主管權限</span>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12" role="status" aria-label="載入中">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <LoadErrorNotice
          title="無法讀取門市"
          message={loadError}
          onRetry={() => {
            setLoading(true);
            fetchStores();
          }}
        />
      ) : stores.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <StoreIcon className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">尚未建立門市</p>
          <p className="mt-1 text-sm text-muted-foreground">新增門市後，再為門市建立店員共用的核銷帳號。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stores.map((store) => (
            <StoreCard
              key={store.id}
              store={store}
              canManage={canManage}
              pendingAccountIds={pendingAccountIds}
              onRename={() => setNameDialog({ mode: "rename", store })}
              onToggleStore={() => handleToggleStore(store)}
              onAddAccount={() => setAccountStore(store)}
              onPrintPoster={() => setPosterStore(store)}
              onToggleRedeem={(account) =>
                patchAccount(
                  account,
                  { canRedeem: !account.canRedeem },
                  account.canRedeem ? `已關閉 ${account.username} 的核銷權限` : `已開啟 ${account.username} 的核銷權限`,
                )
              }
              onAccountAction={handleAccountAction}
            />
          ))}
        </div>
      )}

      <StoreNameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === "rename" ? "門市改名" : "新增門市"}
        initialName={nameDialog?.mode === "rename" ? nameDialog.store.name : ""}
        submitLabel={nameDialog?.mode === "rename" ? "儲存" : "新增門市"}
        onClose={() => setNameDialog(null)}
        onSubmit={submitStoreName}
      />
      <CreateAccountDialog
        store={accountStore}
        onClose={() => setAccountStore(null)}
        onCreated={(account) =>
          setStores((prev) => prev.map((s) => (s.id === account.storeId ? { ...s, accounts: [...s.accounts, account] } : s)))
        }
      />
      <ResetPasswordDialog
        account={resetAccount}
        onClose={() => setResetAccount(null)}
        onDone={() => {
          setResetAccount(null);
          showOk("已重設密碼，這個帳號在所有裝置都要用新密碼重新登入");
        }}
      />
      <StorePosterDialog store={posterStore} onClose={() => setPosterStore(null)} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <CouponToast toast={toast} />
    </div>
  );
}
