'use client';

/**
 * 建立 Rich Menu 流程：
 *  1. 必須帶 ?channelId=<uuid>，否則導回列表
 *  2. 先顯示版型選擇器
 *  3. 選完版型 → 進編輯器
 *  4. 儲存後跳到列表頁
 */

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { LineModuleTabs } from '@/components/line/LineModuleTabs';
import { Button } from '@/components/ui/button';
import { LayoutPicker } from '@/components/line/rich-menu/LayoutPicker';
import { RichMenuEditor, type RichMenuDraft } from '@/components/line/rich-menu/RichMenuEditor';
import type { RichMenuLayout } from '@/components/line/rich-menu/layouts';
import { createRichMenu } from '@/hooks/useRichMenus';

export default function NewRichMenuPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channelId = searchParams?.get('channelId') ?? null;

  const [draft, setDraft] = useState<RichMenuDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 沒帶 channelId → 顯示提示
  if (!channelId) {
    return (
      <div className="flex h-screen flex-col bg-muted">
        <Topbar title="LINE 管理" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-4xl rounded-lg border border-warning/30 bg-warning-subtle p-4 text-sm text-warning">
            缺少 channelId，請從列表頁點「建立 Rich Menu」按鈕進入。
            <Button className="mt-2 block" onClick={() => router.push('/dashboard/line/rich-menus')}>
              回到列表
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const handleLayoutPick = (layout: RichMenuLayout) => {
    setDraft({
      channelId,
      name: `新 Rich Menu（${layout.label}）`,
      chatBarText: '菜單',
      size: layout.size,
      selected: true,
      areas: layout.defaultAreas.map((a) => ({
        bounds: a.bounds,
        action: { type: 'postback', data: '', label: '' },
      })),
      imageUrl: '',
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError('請輸入名稱'); return; }
    if (!draft.chatBarText.trim()) { setError('請輸入底部按鈕文字'); return; }
    if (!draft.imageUrl) { setError('請上傳背景圖'); return; }

    setSaving(true);
    setError(null);
    try {
      await createRichMenu(draft);
      router.push(`/dashboard/line/rich-menus?channelId=${channelId}`);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '建立失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="LINE 管理" />
      <LineModuleTabs active="rich-menus" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (draft) {
                if (confirm('離開將不會儲存變更，確定？')) setDraft(null);
              } else {
                router.push(`/dashboard/line/rich-menus?channelId=${channelId}`);
              }
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {draft ? '重新選擇版型' : '回到列表'}
          </Button>

          {!draft && (
            <div>
              <header className="mb-4">
                <h1 className="text-2xl font-bold tracking-tight">選擇版型</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  從 10 種官方版型挑一個，下一步再填內容。
                </p>
              </header>
              <LayoutPicker onPick={handleLayoutPick} />
            </div>
          )}

          {draft && (
            <div className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <RichMenuEditor draft={draft} onChange={setDraft} />
              <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t bg-white px-6 py-3">
                <Button
                  variant="outline"
                  onClick={() => router.push(`/dashboard/line/rich-menus?channelId=${channelId}`)}
                >
                  取消
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? '儲存中…' : '儲存草稿'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
