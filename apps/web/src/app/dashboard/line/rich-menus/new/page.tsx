'use client';

/**
 * 建立 Rich Menu 流程：
 *  1. 必須帶 ?channelId=<uuid>，否則導回列表
 *  2. 先顯示版型選擇器（步驟 1）
 *  3. 選完版型 → 進編輯器（步驟 2）
 *  4. 儲存後跳到列表頁
 *
 * 版面依 Claude Design「建立 Rich Menu」：標題列右側為步驟指示（步驟 1）／操作按鈕（步驟 2）。
 */

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { LayoutPicker, RichMenuSteps } from '@/components/line/rich-menu/LayoutPicker';
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
      <div className="flex h-full flex-col">
        <Topbar title="建立 Rich Menu" />
        <div className="px-7 pb-7">
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning">
            缺少 channelId，請從列表頁點「建立 Rich Menu」按鈕進入。
            <Button variant="subtle" size="sm" onClick={() => router.push('/dashboard/line/rich-menus')}>
              回到列表
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const backToList = () => router.push(`/dashboard/line/rich-menus?channelId=${channelId}`);

  const handleLayoutPick = (layout: RichMenuLayout) => {
    setError(null);
    setDraft({
      channelId,
      name: `新 Rich Menu（${layout.label}）`,
      chatBarText: '菜單',
      size: layout.size,
      // 預設不設為所有好友的預設選單：一發布就會換掉所有好友目前的選單
      isDefault: false,
      // 聊天室打開時展開選單（LINE 的 selected），與 line-oa-laravel 相同預設展開
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
      backToList();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '建立失敗');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="選擇版型" description="從 10 種官方版型挑一個，下一步再填內容。">
          <RichMenuSteps current={1} />
        </Topbar>
        <div className="flex-1 overflow-auto px-7 pb-7">
          <LayoutPicker onPick={handleLayoutPick} />
          <div className="mt-7 flex justify-end border-t border-border pt-5">
            <Button variant="subtle" onClick={backToList}>取消</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Topbar title="設定內容" description="填好名稱、上傳背景圖並設定每個區域的動作。儲存後回到列表，再按「發布」送到 LINE。">
        <RichMenuSteps current={2} />
      </Topbar>
      <div className="flex-1 overflow-auto px-7 pb-7">
        {error && (
          <div role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <RichMenuEditor draft={draft} onChange={setDraft} />
      </div>
      {/* 底部操作列：固定在內容區底部 */}
      <div className="flex flex-none items-center justify-between gap-3 border-t border-border bg-background px-7 py-4">
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm('重新選擇版型會清掉目前填的內容，確定？')) setDraft(null);
          }}
        >
          重新選擇版型
        </Button>
        <div className="flex gap-3">
          <Button variant="subtle" onClick={backToList}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存草稿'}
          </Button>
        </div>
      </div>
    </div>
  );
}
