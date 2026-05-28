'use client';

/**
 * Quick Reply 預設組管理頁
 *
 * - LINE quick reply 沒有「全域設定」概念，這裡管理的是「可重用按鈕組」
 * - 客服在 MessageInput 加 quick reply 時可一鍵套用整組
 */

import React, { useState } from 'react';
import { Plus, Edit, Trash2, Info } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { LineModuleTabs } from '@/components/line/LineModuleTabs';
import { PresetEditDialog } from '@/components/line/quick-reply/PresetEditDialog';
import { LinePreview } from '@/components/line/quick-reply/LinePreview';
import {
  useQuickReplyPresets,
  createQuickReplyPreset,
  updateQuickReplyPreset,
  deleteQuickReplyPreset,
  type QuickReplyPreset,
} from '@/hooks/useQuickReplyPresets';

export default function QuickReplyPresetsPage() {
  const { presets, isLoading, mutate } = useQuickReplyPresets();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QuickReplyPreset | null>(null);

  const handleOpenCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (preset: QuickReplyPreset) => {
    setEditing(preset);
    setDialogOpen(true);
  };

  const handleSave = async (data: { name: string; items: QuickReplyPreset['items'] }) => {
    if (editing) {
      await updateQuickReplyPreset(editing.id, data);
    } else {
      await createQuickReplyPreset(data);
    }
    await mutate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除這個預設組？')) return;
    try {
      await deleteQuickReplyPreset(id);
      mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '刪除失敗');
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Topbar title="LINE 管理" />
      <LineModuleTabs active="quick-replies" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Quick Reply 預設組</h1>
              <p className="mt-1 text-sm text-slate-500">
                LINE 的「快速回覆」是出現在訊息底部的一排泡泡按鈕，用戶點一下就送出對應訊息給客服。
              </p>
            </div>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-1 h-4 w-4" />
              建立預設組
            </Button>
          </header>

          {/* 是什麼 / 為何要建預設組 — 給第一次看到的人一個入口 */}
          <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-[1fr,320px]">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <Info className="h-4 w-4 text-blue-500" />
                這頁可以做什麼？
              </div>
              <ul className="ml-1 list-disc space-y-1 pl-4 text-sm text-slate-600">
                <li>把常用的按鈕組存起來（例：「同意 / 不同意」、「滿意度 1～5 分」、「想了解 A / B / C 方案」）</li>
                <li>客服在聊天室回訊息時，點「閃電」icon → 「套用預設組」即可一次帶入整組按鈕，不用每次手刻</li>
                <li>每則 LINE 訊息最多 13 個按鈕（LINE 官方限制）</li>
              </ul>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                💡 預設組只是「按鈕模板」，實際送出去時你還是需要打一句訊息內容（例如「請問您是否同意？」），按鈕會自動附在訊息底下
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">範例</div>
              <LinePreview
                message="請問您對本次服務的滿意度？"
                items={[
                  { label: '😍 非常滿意', text: '5 分：非常滿意' },
                  { label: '🙂 還可以', text: '3 分：普通' },
                  { label: '😕 不滿意', text: '1 分：不滿意' },
                ]}
              />
            </div>
          </section>

          {isLoading && (
            <div className="py-12 text-center text-sm text-slate-500">載入中…</div>
          )}

          {!isLoading && presets.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
              <div className="text-sm text-slate-500">尚未建立任何預設組</div>
              <Button className="mt-3" onClick={handleOpenCreate}>
                <Plus className="mr-1 h-4 w-4" />
                建立第一個預設組
              </Button>
            </div>
          )}

          {!isLoading && presets.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  onEdit={() => handleOpenEdit(p)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <PresetEditDialog
        open={dialogOpen}
        preset={editing}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}

function PresetCard({
  preset,
  onEdit,
  onDelete,
}: {
  preset: QuickReplyPreset;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-slate-900">{preset.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {preset.items.length} 個按鈕
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {preset.items.slice(0, 6).map((it, idx) => (
            <span
              key={idx}
              className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px]"
            >
              {it.label}
            </span>
          ))}
          {preset.items.length > 6 && (
            <span className="text-[11px] text-slate-400">+{preset.items.length - 6}</span>
          )}
        </div>

        <div className="text-[11px] text-slate-400">
          {new Date(preset.updatedAt).toISOString().slice(0, 10)}
        </div>

        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Edit className="mr-1 h-3 w-3" />
            編輯
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={onDelete}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            刪除
          </Button>
        </div>
      </div>
    </div>
  );
}
