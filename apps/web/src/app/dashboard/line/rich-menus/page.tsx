'use client';

/**
 * Rich Menu 列表頁
 *
 * 版面依 Claude Design「Rich Menu 列表」：
 * - 標題列：麵包屑（渠道 > Rich Menu）、標題、說明、右側「建立 Rich Menu」
 * - 標題下方：官方帳號篩選（OaSwitcher）＋總數
 * - 卡片網格：縮圖、名稱＋狀態、底部按鈕文字、區域數與日期、依狀態顯示操作與提示
 * 功能與 API 呼叫維持原樣，只換外觀。
 */

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Copy, Trash2, MoreHorizontal, Send, Undo2, Users, LayoutGrid, ImageIcon, MessageSquare } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AddIcon, EditIcon } from '@/components/icons/figma-icons';
import { OaSwitcher } from '@/components/line/OaSwitcher';
import { RichMenuBindDialog } from '@/components/line/rich-menu/RichMenuBindDialog';
import { richMenuStatusInfo } from '@/components/line/rich-menu/status';
import {
  useRichMenus,
  deleteRichMenu,
  duplicateRichMenu,
  publishRichMenu,
  unpublishRichMenu,
  type RichMenu,
} from '@/hooks/useRichMenus';
import {
  RICH_MENU_DEFAULT_NOT_SET_NOTICE,
  richMenuPublishConfirm,
  richMenuUnpublishConfirm,
} from '@/lib/rich-menu-confirm';
import { isRichMenuPublishInterrupted } from '@/lib/rich-menu-status';
import { EmptyState } from '@/components/shared/EmptyState';

export default function RichMenusPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialChannelId = searchParams?.get('channelId') ?? null;
  const [channelId, setChannelId] = useState<string | null>(initialChannelId);

  const { richMenus, isLoading, mutate } = useRichMenus(channelId);
  const goCreate = () => router.push(`/dashboard/line/rich-menus/new?channelId=${channelId}`);

  // OA 切換時同步 URL
  const handleOaChange = (newChannelId: string) => {
    setChannelId(newChannelId || null);
    if (newChannelId) {
      router.replace(`/dashboard/line/rich-menus?channelId=${newChannelId}`);
    } else {
      router.replace('/dashboard/line/rich-menus');
    }
  };

  // URL channelId 變化時同步 state
  useEffect(() => {
    const urlChannelId = searchParams?.get('channelId') ?? null;
    if (urlChannelId !== channelId) {
      setChannelId(urlChannelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這個 Rich Menu 草稿嗎？')) return;
    try {
      await deleteRichMenu(id);
      mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '刪除失敗');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateRichMenu(id);
      mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '複製失敗');
    }
  };

  const handlePublish = async (id: string) => {
    const isDefault = Boolean(richMenus.find((m) => m.id === id)?.isDefault);
    if (!confirm(richMenuPublishConfirm(isDefault))) return;
    try {
      const result = await publishRichMenu(id);
      mutate();
      if (result?.warnings?.includes('DEFAULT_NOT_SET')) alert(RICH_MENU_DEFAULT_NOT_SET_NOTICE);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '發布失敗');
    }
  };

  const handleUnpublish = async (id: string) => {
    const isDefault = Boolean(richMenus.find((m) => m.id === id)?.isDefault);
    if (!confirm(richMenuUnpublishConfirm(isDefault))) return;
    try {
      await unpublishRichMenu(id);
      mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '取消發布失敗');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Topbar title="Rich Menu" description="LINE 聊天視窗底部的固定選單。建立草稿後可直接發布到 LINE。">
        {channelId && (
          <Button size="lg" onClick={goCreate}>
            <AddIcon />
            建立 Rich Menu
          </Button>
        )}
      </Topbar>

      <div className="flex flex-1 flex-col gap-5 overflow-auto px-7 pb-7">
        <div className="flex flex-wrap items-center gap-3">
          <OaSwitcher value={channelId} onChange={handleOaChange} />
          {channelId && !isLoading && richMenus.length > 0 && (
            <span className="text-sm text-muted-foreground">共 {richMenus.length} 個</span>
          )}
        </div>

        {!channelId && (
          <div className="rounded-lg border border-border bg-muted">
            <EmptyState
              icon={<MessageSquare />}
              title="請先選擇官方帳號"
              description="Rich Menu 依官方帳號分開管理。從上方「官方帳號」選擇後，才會列出該帳號的選單。"
            />
          </div>
        )}

        {channelId && isLoading && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="載入中">
            {[0, 1, 2].map((i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-border bg-background">
                <div className="h-[200px] animate-pulse bg-muted" />
                <div className="space-y-3 p-4">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-8 w-40 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}

        {channelId && !isLoading && richMenus.length === 0 && (
          <div className="rounded-lg border border-border">
            <EmptyState
              icon={<LayoutGrid />}
              title="尚未建立任何 Rich Menu"
              description="Rich Menu 是 LINE 聊天室下方的圖文選單"
              action={
                <Button onClick={goCreate}>
                  <AddIcon />
                  建立第一個 Rich Menu
                </Button>
              }
            />
          </div>
        )}

        {channelId && !isLoading && richMenus.length > 0 && (
          <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {richMenus.map((rm) => (
              <li key={rm.id}>
                <RichMenuCard
                  richMenu={rm}
                  onEdit={(id) => router.push(`/dashboard/line/rich-menus/${id}`)}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                  onPublish={handlePublish}
                  onUnpublish={handleUnpublish}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RichMenuCard({
  richMenu,
  onEdit,
  onDuplicate,
  onDelete,
  onPublish,
  onUnpublish,
}: {
  richMenu: RichMenu;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onUnpublish: (id: string) => void;
}) {
  const [bindOpen, setBindOpen] = useState(false);
  const interrupted = isRichMenuPublishInterrupted(richMenu);
  const status = richMenuStatusInfo(richMenu);
  const isPublished = richMenu.status === 'published';
  const isPublishing = richMenu.status === 'publishing' && !interrupted;
  // 發布失敗或中斷的選單可以重新發布；還在發布中的選單要等它完成或中斷超過 5 分鐘
  const canPublish = richMenu.status === 'draft' || richMenu.status === 'error' || interrupted;

  const hint = isPublishing
    ? '正在發布到 LINE，請稍後重新整理'
    : interrupted
      ? '發布過程中斷，請重新發布'
      : richMenu.status === 'error'
        ? '上次發布失敗，可修正內容後重新發布'
        : null;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background">
      {/* 縮圖：背景圖完整顯示（大、小選單比例不同，用固定高度置中） */}
      <div className="flex h-[200px] items-center justify-center border-b border-border bg-muted p-4">
        {richMenu.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={richMenu.imageUrl} alt={`${richMenu.name} 背景圖`} className="max-h-full max-w-full rounded object-contain" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input text-sm text-muted-foreground">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
            無背景圖
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-base font-semibold leading-6 text-foreground" title={richMenu.name}>
            {richMenu.name}
          </h3>
          <Badge variant={status.variant} className="mt-0.5">{status.label}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          底部按鈕：{richMenu.chatBarText}
          {isPublished && richMenu.isDefault ? ' · 所有好友的預設選單' : ''}
        </p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {richMenu.areas.length} 區域 · {new Date(richMenu.updatedAt).toISOString().slice(0, 10)}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {canPublish && (
              <Button size="sm" onClick={() => onPublish(richMenu.id)}>
                <Send aria-hidden="true" />
                發布
              </Button>
            )}
            {isPublished && (
              <Button variant="secondary" size="sm" onClick={() => setBindOpen(true)}>
                <Users aria-hidden="true" />
                綁定受眾
              </Button>
            )}
            {isPublished && (
              <Button variant="subtle" size="sm" onClick={() => onUnpublish(richMenu.id)}>
                <Undo2 aria-hidden="true" />
                取消發布
              </Button>
            )}
            <Button
              variant="subtle"
              size="sm"
              onClick={() => onEdit(richMenu.id)}
              disabled={isPublished}
              title={isPublished ? '已發布需先取消發布才能編輯' : undefined}
            >
              <EditIcon aria-hidden="true" />
              編輯
            </Button>
          </div>
          <DropdownMenu
            align="right"
            trigger={
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-tertiary-foreground hover:bg-shell">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">更多操作</span>
              </span>
            }
          >
            <DropdownMenuItem onClick={() => onDuplicate(richMenu.id)}>
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />複製
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              disabled={isPublished}
              title={isPublished ? '已發布需先取消發布才能刪除' : undefined}
              onClick={() => onDelete(richMenu.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />刪除
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
        {hint && <p className="pt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>

      {bindOpen && (
        <RichMenuBindDialog
          richMenuId={richMenu.id}
          richMenuName={richMenu.name}
          onClose={() => setBindOpen(false)}
        />
      )}
    </article>
  );
}
