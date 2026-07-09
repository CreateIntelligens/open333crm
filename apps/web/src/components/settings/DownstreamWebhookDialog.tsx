'use client';

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

type ForwardMode = 'immediate' | 'after';

interface DownstreamWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: {
    id: string;
    displayName: string;
    settings?: Record<string, unknown>;
  } | null;
  onSaved: () => void;
}

export function DownstreamWebhookDialog({
  open,
  onOpenChange,
  channel,
  onSaved,
}: DownstreamWebhookDialogProps) {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<ForwardMode>('after');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dsw = (channel?.settings as Record<string, unknown> | undefined)?.downstreamWebhook as
      | { enabled?: boolean; url?: string; mode?: ForwardMode }
      | undefined;
    setEnabled(dsw?.enabled ?? false);
    setUrl(dsw?.url ?? '');
    setMode(dsw?.mode === 'immediate' ? 'immediate' : 'after');
    setError(null);
  }, [channel, open]);

  const handleSave = async () => {
    if (!channel) return;
    setSaving(true);
    setError(null);

    try {
      const trimmedUrl = url.trim();
      if (trimmedUrl && !/^https:\/\//i.test(trimmedUrl)) {
        setError('下游 URL 必須為 https');
        setSaving(false);
        return;
      }

      const existingSettings = (channel.settings || {}) as Record<string, unknown>;
      const settingsPayload: Record<string, unknown> = { ...existingSettings };
      // Omit the key entirely when no URL is set (empty url would fail the
      // backend https validation, and means "not configured").
      if (trimmedUrl) {
        settingsPayload.downstreamWebhook = { enabled, url: trimmedUrl, mode };
      } else {
        delete settingsPayload.downstreamWebhook;
      }

      await api.patch(`/channels/${channel.id}`, { settings: settingsPayload });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>下游 Webhook 轉發 — {channel?.displayName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
          <p className="text-xs text-muted-foreground">
            將此渠道收到的 webhook 原封轉發到下游系統（原始 header 與 body 不做任何變更）。轉發為背景送出、不追蹤結果，不影響對來源平台的即時回應。
          </p>

          {/* Enable */}
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
            <label className="text-sm font-medium" htmlFor="dsEnabled">
              啟用轉發
            </label>
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input
                id="dsEnabled"
                type="checkbox"
                className="h-4 w-4"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>{enabled ? '已開啟' : '已關閉'}</span>
            </label>
          </div>

          {/* URL */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">下游 URL</label>
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://downstream.example.com/hook"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              必須為 https，且不可指向內網／保留位址。清空並儲存即移除設定。
            </p>
          </div>

          {/* Mode */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">轉發模式</label>
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as ForwardMode)}
              options={[
                { value: 'after', label: '最後轉發（本系統照常處理，處理後再轉發一份）' },
                { value: 'immediate', label: '立即轉發（下游接手，本系統不再處理）' },
              ]}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === 'immediate'
                ? '收到即背景轉發並短路：不建立訊息、不觸發後續動作。'
                : '本系統照常建立訊息與後續動作，處理完再背景轉發一份給下游。'}
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                儲存中...
              </>
            ) : (
              '儲存'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
