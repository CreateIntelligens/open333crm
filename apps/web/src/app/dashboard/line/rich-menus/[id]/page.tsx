'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Send, Undo2 } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { LineModuleTabs } from '@/components/line/LineModuleTabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RichMenuEditor, type RichMenuDraft } from '@/components/line/rich-menu/RichMenuEditor';
import {
  useRichMenu,
  updateRichMenu,
  publishRichMenu,
  unpublishRichMenu,
} from '@/hooks/useRichMenus';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  published: { label: '已發布', color: '#22c55e' },
  error: { label: '發布失敗', color: '#ef4444' },
};

export default function EditRichMenuPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { richMenu, isLoading, mutate } = useRichMenu(id);
  const [draft, setDraft] = useState<RichMenuDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPublished = richMenu?.status === 'published';
  const statusInfo = richMenu
    ? STATUS_LABELS[richMenu.status] || { label: richMenu.status, color: '#6b7280' }
    : null;

  useEffect(() => {
    if (!richMenu) return;
    setDraft({
      channelId: richMenu.channelId,
      name: richMenu.name,
      chatBarText: richMenu.chatBarText,
      size: richMenu.size,
      selected: richMenu.selected,
      areas: richMenu.areas,
      imageUrl: richMenu.imageUrl,
    });
  }, [richMenu]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await updateRichMenu(id, {
        name: draft.name,
        chatBarText: draft.chatBarText,
        size: draft.size,
        selected: draft.selected,
        areas: draft.areas,
        imageUrl: draft.imageUrl,
      });
      await mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm('確定發布到 LINE？發布後將無法直接編輯，需先取消發布。')) return;
    setBusy(true);
    setError(null);
    try {
      await publishRichMenu(id);
      await mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '發布失敗');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm('確定取消發布？將從 LINE 移除此 Rich Menu。')) return;
    setBusy(true);
    setError(null);
    try {
      await unpublishRichMenu(id);
      await mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '取消發布失敗');
    } finally {
      setBusy(false);
    }
  };

  const backToList = () => {
    const cid = richMenu?.channelId ?? draft?.channelId;
    router.push(cid ? `/dashboard/line/rich-menus?channelId=${cid}` : '/dashboard/line/rich-menus');
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Topbar title="LINE 管理" />
      <LineModuleTabs active="rich-menus" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={backToList}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              回到列表
            </Button>
            {statusInfo && (
              <Badge color={statusInfo.color}>{statusInfo.label}</Badge>
            )}
          </div>

          {isPublished && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              此 Rich Menu 已發布到 LINE，不能直接修改。請先「取消發布」後再編輯。
            </div>
          )}

          {isLoading && <div className="py-12 text-center text-sm text-slate-500">載入中…</div>}

          {!isLoading && !richMenu && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              找不到此 Rich Menu，可能已被刪除。
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {draft && (
            <div className="space-y-4">
              <fieldset disabled={isPublished} className={isPublished ? 'opacity-60' : ''}>
                <RichMenuEditor draft={draft} onChange={setDraft} />
              </fieldset>
              <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t bg-white px-6 py-3">
                <Button variant="outline" onClick={backToList}>取消</Button>
                {!isPublished && (
                  <Button variant="outline" onClick={handleSave} disabled={saving || busy}>
                    {saving ? '儲存中…' : '儲存草稿'}
                  </Button>
                )}
                {!isPublished ? (
                  <Button onClick={handlePublish} disabled={saving || busy}>
                    <Send className="mr-1 h-4 w-4" />
                    {busy ? '發布中…' : '發布到 LINE'}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={handleUnpublish} disabled={busy}>
                    <Undo2 className="mr-1 h-4 w-4" />
                    {busy ? '取消中…' : '取消發布'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
