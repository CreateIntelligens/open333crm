'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { usePermission } from '@/providers/AuthProvider';
import { getApiErrorMessage } from '@/lib/api-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * 以 Facebook 登入連結粉專（平台持有的 Meta App，change fix-meta-webhook-page-routing 第 3 階段）。
 * 流程：按鈕 → Facebook 授權 → 導回渠道管理頁（?metaConnect=...）→ 選擇粉專 → 建立渠道。
 * 租戶不需要準備自己的 Meta 應用程式、App Secret 或驗證權杖。
 */

/** 平台已設定 Meta App、且有建立渠道權限時才顯示「用 Facebook 連結粉專」 */
export function useMetaConnectConfigured(): boolean {
  const canCreate = usePermission('channel.create');
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    if (!canCreate) return;
    let cancelled = false;
    api
      .get('/meta-connect/status')
      .then((res) => {
        if (!cancelled) setConfigured(Boolean(res.data?.data?.configured));
      })
      .catch(() => {
        // 沒權限或未設定：不顯示按鈕即可，不影響渠道管理其他功能
      });
    return () => {
      cancelled = true;
    };
  }, [canCreate]);
  return canCreate && configured;
}

export function MetaConnectButton({ onError }: { onError: (message: string) => void }) {
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    try {
      const res = await api.post('/meta-connect/start');
      window.location.href = res.data.data.url as string;
    } catch (err) {
      onError(getApiErrorMessage(err, '無法開始 Facebook 授權，請稍後重試'));
      setStarting(false);
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={start} disabled={starting}>
      {starting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
      用 Facebook 連結粉專
    </Button>
  );
}

/** callback 失敗原因（後端以 ?metaConnectError= 帶回） */
export const META_CONNECT_ERROR_TEXT: Record<string, string> = {
  denied: '已取消 Facebook 授權，沒有連結任何粉專。',
  invalid_state: '授權連結已過期或無效，請重新點「用 Facebook 連結粉專」。',
  exchange_failed: '無法向 Facebook 取得授權，請稍後重試。',
  no_pages: '這個 Facebook 帳號沒有可管理的粉專，或授權時沒有勾選任何粉專。',
  not_configured: '平台尚未設定 Facebook 應用程式，暫時無法使用。',
};

interface ConnectablePage {
  id: string;
  name: string;
  pictureUrl: string | null;
  linkedInThisTenant: boolean;
  /** platform 可重新連結；own_app 是自備應用程式連結的，要在渠道編輯更新權杖 */
  linkedMode: 'platform' | 'own_app' | null;
}

type ConnectResult =
  | { pageId: string; status: 'connected'; channelId: string }
  | { pageId: string; status: 'reconnected'; channelId: string }
  | { pageId: string; status: 'failed'; code: string; message: string };

export function MetaConnectDialog({
  connectId,
  onClose,
  onConnected,
}: {
  connectId: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [pages, setPages] = useState<ConnectablePage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ConnectResult[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(`/meta-connect/sessions/${encodeURIComponent(connectId)}/pages`)
      .then((res) => setPages(res.data.data as ConnectablePage[]))
      .catch((err) => setLoadError(getApiErrorMessage(err, '讀取粉專清單失敗')));
  }, [connectId]);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.post(`/meta-connect/sessions/${encodeURIComponent(connectId)}/connect`, {
        pageIds: [...selected],
      });
      const r = res.data.data as ConnectResult[];
      setResults(r);
      if (r.some((x) => x.status !== 'failed')) onConnected();
      // 已連結成功的從選取中移除，失敗的保留讓使用者重試
      setSelected(new Set(r.filter((x) => x.status === 'failed').map((x) => x.pageId)));
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, '連結粉專失敗，請稍後重試'));
    } finally {
      setSubmitting(false);
    }
  };

  const resultOf = (id: string) => results?.find((r) => r.pageId === id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>選擇要連結的粉專</DialogTitle>
        </DialogHeader>

        {loadError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>}
        {!pages && !loadError && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 讀取中...
          </div>
        )}

        {pages && (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {pages.map((p) => {
              const r = resultOf(p.id);
              // 本次已處理成功的、或用自備應用程式連結的鎖住；以平台方式連著的粉專可以勾選，重新連結以更新權杖
              const ownApp = p.linkedMode === 'own_app';
              const done = r?.status === 'connected' || r?.status === 'reconnected' || ownApp;
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border p-3 ${done ? 'opacity-60' : 'cursor-pointer'}`}
                >
                  <Checkbox
                    checked={selected.has(p.id)}
                    disabled={done || submitting}
                    onCheckedChange={(v: boolean) => toggle(p.id, v)}
                  />
                  {p.pictureUrl ? (
                    <img src={p.pictureUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.id}</p>
                    {r?.status === 'failed' && <p className="mt-0.5 text-xs text-destructive">{r.message}</p>}
                    {!r && p.linkedMode === 'platform' && (
                      <p className="mt-0.5 text-xs text-muted-foreground">已連結。勾選可重新連結並更新權杖，原本的對話紀錄會保留。</p>
                    )}
                    {ownApp && (
                      <p className="mt-0.5 text-xs text-muted-foreground">已用自備應用程式連結。要更新權杖，請在渠道管理編輯該渠道。</p>
                    )}
                  </div>
                  {ownApp && <span className="shrink-0 text-xs text-muted-foreground">已連結</span>}
                  {r?.status === 'connected' && <span className="shrink-0 text-xs text-success">已連結</span>}
                  {r?.status === 'reconnected' && <span className="shrink-0 text-xs text-success">已重新連結</span>}
                </label>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          連結後系統會訂閱該粉專的訊息，不需要另外設定 Webhook。同一個粉專只能連結一次。
        </p>
        {submitError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{submitError}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {results?.some((r) => r.status !== 'failed') ? '完成' : '取消'}
          </Button>
          <Button onClick={submit} disabled={submitting || selected.size === 0}>
            {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            連結所選粉專
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
