'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QuickReplyEditor, type QuickReplyItem } from '@/components/materials/QuickReplyEditor';
import { LinePreview } from './LinePreview';
import type { QuickReplyPreset } from '@/hooks/useQuickReplyPresets';

interface Props {
  open: boolean;
  preset: QuickReplyPreset | null; // null = 新建模式
  onClose: () => void;
  onSave: (data: { name: string; items: QuickReplyItem[] }) => Promise<void>;
}

export function PresetEditDialog({ open, preset, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [items, setItems] = useState<QuickReplyItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(preset?.name ?? '');
      setItems(preset?.items ?? []);
      setError(null);
    }
  }, [open, preset]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('請輸入名稱');
      return;
    }
    if (items.length === 0) {
      setError('至少要 1 個按鈕');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), items });
      onClose();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {preset ? '編輯預設組' : '建立 Quick Reply 預設組'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              建好後客服回訊息時可一鍵套用，省去每次手刻按鈕
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-[1fr,320px]">
          {/* 左：編輯區 */}
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                這組叫什麼名字？*
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 100))}
                placeholder="例：滿意度調查、預約時段、是否同意條款"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                只是給你自己辨識用，不會給用戶看
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                按鈕設定
              </label>
              <div className="mb-2 rounded border border-border bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                <strong>按鈕文字</strong>：用戶在 LINE 看到的按鈕字（≤ 20 字）<br />
                <strong>點擊後送出文字</strong>：用戶點下去後，系統幫他送什麼訊息給客服（留空就送同按鈕文字）
              </div>
              <QuickReplyEditor value={items} onChange={setItems} />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* 右：即時預覽 */}
          <aside className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              用戶在 LINE 看到的樣子
            </div>
            <LinePreview message="請選擇您要的選項：" items={items} />
            <p className="text-[11px] text-muted-foreground">
              用戶點按鈕後，會自動送出你設定的「點擊後送出文字」進到對話
            </p>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
