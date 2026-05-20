'use client';

/**
 * Rich Menu 列表頁
 *
 * - 上方：OaSwitcher（多 LINE OA 切換）+ LineModuleTabs
 * - 中間：「+ 建立 Rich Menu」按鈕
 * - 下方：網格卡片或空狀態
 */

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Copy, Trash2, Edit, MoreHorizontal } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OaSwitcher } from '@/components/line/OaSwitcher';
import { LineModuleTabs } from '@/components/line/LineModuleTabs';
import {
  useRichMenus,
  deleteRichMenu,
  duplicateRichMenu,
  type RichMenu,
} from '@/hooks/useRichMenus';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#94a3b8' },
  published: { label: '已發布', color: '#22c55e' },
  error: { label: '發布失敗', color: '#ef4444' },
};

export default function RichMenusPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialChannelId = searchParams?.get('channelId') ?? null;
  const [channelId, setChannelId] = useState<string | null>(initialChannelId);

  const { richMenus, isLoading, mutate } = useRichMenus(channelId);

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

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <Topbar title="LINE 管理" />

      <div className="border-b bg-white px-6 py-3">
        <OaSwitcher value={channelId} onChange={handleOaChange} />
      </div>

      <LineModuleTabs active="rich-menus" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Rich Menu</h1>
              <p className="mt-1 text-sm text-slate-500">
                LINE 聊天視窗底部的固定選單。本期僅支援草稿管理，發布功能後續上線。
              </p>
            </div>
            {channelId && (
              <Button
                onClick={() => router.push(`/dashboard/line/rich-menus/new?channelId=${channelId}`)}
              >
                <Plus className="mr-1 h-4 w-4" />
                建立 Rich Menu
              </Button>
            )}
          </header>

          {!channelId && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
              <div className="text-sm text-slate-500">請先選擇 LINE 官方帳號</div>
            </div>
          )}

          {channelId && isLoading && (
            <div className="py-12 text-center text-sm text-slate-500">載入中…</div>
          )}

          {channelId && !isLoading && richMenus.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
              <div className="text-sm text-slate-500">尚未建立任何 Rich Menu</div>
              <Button
                className="mt-3"
                onClick={() => router.push(`/dashboard/line/rich-menus/new?channelId=${channelId}`)}
              >
                <Plus className="mr-1 h-4 w-4" />
                建立第一個 Rich Menu
              </Button>
            </div>
          )}

          {channelId && !isLoading && richMenus.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {richMenus.map((rm) => (
                <RichMenuCard
                  key={rm.id}
                  richMenu={rm}
                  onEdit={(id) => router.push(`/dashboard/line/rich-menus/${id}`)}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function RichMenuCard({
  richMenu,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  richMenu: RichMenu;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const statusInfo = STATUS_LABELS[richMenu.status] || { label: richMenu.status, color: '#6b7280' };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* 縮圖：背景圖（高度比例壓縮，避免大選單把卡片撐爆） */}
      <div className="relative aspect-[2500/843] w-full overflow-hidden bg-slate-100">
        {richMenu.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={richMenu.imageUrl} alt={richMenu.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">無背景圖</div>
        )}
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-slate-900">{richMenu.name}</div>
            <div className="mt-0.5 text-xs text-slate-500">{richMenu.chatBarText}</div>
          </div>
          <Badge color={statusInfo.color}>{statusInfo.label}</Badge>
        </div>

        <div className="text-[11px] text-slate-400">
          {richMenu.areas.length} 區域 · {new Date(richMenu.updatedAt).toISOString().slice(0, 10)}
        </div>

        <div className="flex items-center justify-end gap-1 pt-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(richMenu.id)}>
            <Edit className="mr-1 h-3 w-3" />
            編輯
          </Button>
          <div className="relative">
            <Button variant="ghost" size="sm" onClick={() => setMenuOpen((v) => !v)}>
              <MoreHorizontal className="h-3 w-3" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-28 rounded-md border border-slate-200 bg-white py-1 shadow-md">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                  onClick={() => { setMenuOpen(false); onDuplicate(richMenu.id); }}
                >
                  <Copy className="h-3 w-3" />複製
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                  onClick={() => { setMenuOpen(false); onDelete(richMenu.id); }}
                >
                  <Trash2 className="h-3 w-3" />刪除
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
