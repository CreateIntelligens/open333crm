'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Send, Undo2, Info } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RichMenuEditor, type RichMenuDraft } from '@/components/line/rich-menu/RichMenuEditor';
import {
  useRichMenu,
  updateRichMenu,
  publishRichMenu,
  unpublishRichMenu,
} from '@/hooks/useRichMenus';

import { richMenuPublishConfirm, richMenuUnpublishConfirm, RICH_MENU_DEFAULT_NOT_SET_NOTICE } from '@/lib/rich-menu-confirm';
import { isRichMenuPublishInterrupted, isRichMenuPublishing } from '@/lib/rich-menu-status';
import { richMenuStatusInfo } from '@/components/line/rich-menu/status';

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
  // 另一個請求正在發布：不能編輯、不能再發布，等它完成或中斷超過 5 分鐘
  const isPublishing = richMenu ? isRichMenuPublishing(richMenu) : false;
  // 發布中斷：可以重新發布；狀態仍是發布中，API 不接受修改
  const interrupted = richMenu ? isRichMenuPublishInterrupted(richMenu) : false;
  const locked = isPublished || isPublishing || interrupted;
  const statusInfo = richMenu ? richMenuStatusInfo(richMenu) : null;

  useEffect(() => {
    if (!richMenu) return;
    setDraft({
      channelId: richMenu.channelId,
      name: richMenu.name,
      chatBarText: richMenu.chatBarText,
      size: richMenu.size,
      selected: richMenu.selected,
      isDefault: richMenu.isDefault,
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
        isDefault: draft.isDefault,
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
    if (!confirm(richMenuPublishConfirm(Boolean(richMenu?.isDefault)))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishRichMenu(id);
      await mutate();
      if (result?.warnings?.includes('DEFAULT_NOT_SET')) alert(RICH_MENU_DEFAULT_NOT_SET_NOTICE);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? '發布失敗');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm(richMenuUnpublishConfirm(Boolean(richMenu?.isDefault)))) return;
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

  // 版面依 Claude Design「Rich Menu 編輯器」：標題列（麵包屑＋名稱）、狀態提示條、雙欄編輯器、
  // 底部固定操作列（左：狀態，右：取消／儲存草稿／發布）。
  return (
    <div className="flex h-full flex-col">
      <Topbar title={richMenu?.name || '編輯 Rich Menu'} />

      <div className="flex-1 overflow-auto px-7 pb-7">
        <div className="space-y-5">
          {isPublished && (
            <Notice>此 Rich Menu 已發布到 LINE，不能直接修改。請先「取消發布」後再編輯。</Notice>
          )}
          {isPublishing && <Notice>此 Rich Menu 正在發布到 LINE，請稍後重新整理。</Notice>}
          {interrupted && <Notice>此 Rich Menu 的發布中斷了，請按「發布到 LINE」重新發布。</Notice>}

          {isLoading && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy="true" aria-label="載入中">
              <div className="space-y-5">
                {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />)}
              </div>
              <div className="h-[520px] animate-pulse rounded-lg bg-muted" />
            </div>
          )}

          {!isLoading && !richMenu && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
              找不到此 Rich Menu，可能已被刪除。
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-subtle px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {draft && (
            <fieldset disabled={locked} className={locked ? 'opacity-70' : ''}>
              <legend className="sr-only">Rich Menu 內容</legend>
              <RichMenuEditor draft={draft} onChange={setDraft} />
            </fieldset>
          )}
        </div>
      </div>

      {draft && (
        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-7 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            狀態
            {statusInfo && <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="subtle" onClick={backToList}>回到列表</Button>
            {!locked && (
              <Button variant="subtle" onClick={handleSave} disabled={saving || busy}>
                {saving ? '儲存中…' : '儲存草稿'}
              </Button>
            )}
            {isPublishing ? null : !isPublished ? (
              <Button onClick={handlePublish} disabled={saving || busy}>
                <Send aria-hidden="true" />
                {busy ? '發布中…' : '發布到 LINE'}
              </Button>
            ) : (
              <Button variant="outline" onClick={handleUnpublish} disabled={busy}>
                <Undo2 aria-hidden="true" />
                {busy ? '取消中…' : '取消發布'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning">
      <Info className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
