'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';

interface BindingHandleView {
  channelType: string;
  bindingHandle: string | null;
  bindingHandleAuto: string | null;
  effectiveHandle: string | null;
  fbGetStartedConfigured: boolean | null;
}

const HANDLE_LABEL: Record<string, { label: string; placeholder: string; hint: string }> = {
  LINE: {
    label: 'LINE Basic ID',
    placeholder: '@abc1234',
    hint: '在 LINE Official Account Manager 的帳號設定可找到，以 @ 開頭。',
  },
  FB: {
    label: '粉絲專頁 username 或 ID',
    placeholder: 'my.shop',
    hint: '粉專網址 facebook.com/ 後面那段；沒有 username 可填粉專 ID。',
  },
  THREADS: {
    label: 'Instagram 帳號',
    placeholder: 'my.shop',
    hint: 'IG 帳號名稱（不含 @）。',
  },
};

/**
 * 跨渠道綁定用的導流識別：產生加好友／m.me／ig.me 連結時使用。
 * 按「測試連線」時系統會自動取得；自動取得不到或要改用其他值時可在此手動填寫。
 */
export function ChannelBindingHandleField({
  channelId,
  channelType,
  channelName,
}: {
  channelId: string;
  channelType: string;
  /** 正在編輯的渠道名稱：同一租戶可能接多個 LINE OA／粉專，標題要看得出是哪一個 */
  channelName?: string;
}) {
  const meta = HANDLE_LABEL[channelType];
  const [view, setView] = useState<BindingHandleView | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    setError(null);
    api
      .get(`/channels/${channelId}/binding-handle`)
      .then((res) => {
        if (cancelled) return;
        const data = res.data.data as BindingHandleView;
        setView(data);
        setValue(data.bindingHandle ?? '');
      })
      .catch((err) => {
        if (!cancelled) setError(getApiErrorMessage(err, '讀取導流識別失敗'));
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, meta]);

  if (!meta) return null;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.patch(`/channels/${channelId}/binding-handle`, {
        bindingHandle: value.trim() || null,
      });
      const data = res.data.data as BindingHandleView;
      setView(data);
      setValue(data.bindingHandle ?? '');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(getApiErrorMessage(err, '儲存導流識別失敗，請稍後重試'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">
          跨渠道綁定：{meta.label}
          {channelName && <span className="ml-1 font-normal text-muted-foreground">（{channelName}）</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          顧客要綁定此帳號時，系統用它產生連結。{meta.hint}
        </p>
      </div>

      {view && (
        <p className="text-xs text-muted-foreground">
          自動取得：{view.bindingHandleAuto ?? '尚未取得（請在渠道卡片按「測試連線」）'}
          {view.effectiveHandle ? `｜目前使用：${view.effectiveHandle}` : ''}
        </p>
      )}

      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={view?.bindingHandleAuto ? `留空則使用自動取得的 ${view.bindingHandleAuto}` : meta.placeholder}
        />
        <Button type="button" variant="outline" onClick={handleSave} disabled={saving} className="shrink-0">
          {saving ? '儲存中...' : '儲存'}
        </Button>
      </div>
      {saved && <p className="text-xs text-success">已儲存</p>}

      {channelType === 'FB' && view?.fbGetStartedConfigured === false && (
        <div className="rounded-md bg-warning-subtle p-2 text-xs text-warning">
          此粉專尚未設定「開始使用」按鈕。第一次私訊的顧客點綁定連結後，代碼不會送到系統，
          請到 Meta Business Suite 設定，或請顧客開啟對話後直接貼上代碼。
        </div>
      )}
      {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
    </div>
  );
}
