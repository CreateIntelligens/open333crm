'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { LineModuleTabs } from '@/components/line/LineModuleTabs';
import { Button } from '@/components/ui/button';
import { RichMenuEditor, type RichMenuDraft } from '@/components/line/rich-menu/RichMenuEditor';
import { useRichMenu, updateRichMenu } from '@/hooks/useRichMenus';

export default function EditRichMenuPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { richMenu, isLoading, mutate } = useRichMenu(id);
  const [draft, setDraft] = useState<RichMenuDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <Button variant="ghost" size="sm" onClick={backToList}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            回到列表
          </Button>

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
              <RichMenuEditor draft={draft} onChange={setDraft} />
              <div className="sticky bottom-0 -mx-6 flex justify-end gap-2 border-t bg-white px-6 py-3">
                <Button variant="outline" onClick={backToList}>取消</Button>
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
