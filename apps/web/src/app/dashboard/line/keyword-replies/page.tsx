'use client';

/**
 * LINE 關鍵字回覆管理頁
 *
 * 用戶傳訊息含關鍵字時 → 自動回對應素材。
 * 底層走 automation rules (keyword.matched + send_material)。
 */

import React, { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { AddIcon, DeleteIcon, EditIcon } from '@/components/icons/figma-icons';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { KeywordReplyEditDialog } from '@/components/line/keyword-reply/KeywordReplyEditDialog';
import { useMaterials } from '@/hooks/useMaterials';
import {
  useKeywordReplies,
  createKeywordReply,
  updateKeywordReply,
  deleteKeywordReply,
  toggleKeywordReply,
  type KeywordReply,
} from '@/hooks/useKeywordReplies';

// 欄寬依 Claude Design：狀態、規則名稱、關鍵字、回覆素材、動作（固定欄寬，避免文字被擠成直排）
const COLS = 'grid grid-cols-[120px_minmax(160px,1fr)_minmax(220px,1.4fr)_minmax(160px,1fr)_150px] items-center gap-4 px-5';
const CONTENT_TYPE_LABEL: Record<string, string> = { text: '文字', image: '圖片', flex: 'Flex', carousel: '輪播', imagemap: '圖文', video: '影片' };

export default function KeywordRepliesPage() {
  const { replies, isLoading, mutate } = useKeywordReplies();
  const { materials } = useMaterials({ channelType: 'line', isActive: true, limit: 200 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KeywordReply | null>(null);

  const materialMap = new Map(materials.map((m) => [m.id, m]));

  const handleOpenCreate = () => { setEditing(null); setDialogOpen(true); };
  const handleOpenEdit = (r: KeywordReply) => { setEditing(r); setDialogOpen(true); };

  const handleSave = async (input: Parameters<typeof createKeywordReply>[0]) => {
    if (editing) {
      await updateKeywordReply(editing.id, input);
    } else {
      await createKeywordReply(input);
    }
    await mutate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除這條關鍵字回覆？')) return;
    try {
      await deleteKeywordReply(id);
      mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '刪除失敗');
    }
  };

  const handleToggle = async (r: KeywordReply) => {
    try {
      await toggleKeywordReply(r.id, !r.isActive);
      mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '更新失敗');
    }
  };

  // 版面依 Claude Design「關鍵字回覆」：標題列＋建立、可收合的使用說明、規則列表、總數。
  // 設計稿的「渠道篩選／渠道欄」「優惠券」是 main 的新功能，分支尚未合併，合併 main 後再補。
  // 使用說明的觸發規則依「本分支」實際行為（bot 模式才觸發、每位聯繫人每條規則 1 小時最多 3 次）。
  return (
    <div className="flex h-full flex-col">
      <Topbar
        title="關鍵字回覆"
        description="顧客在 LINE 傳送的訊息出現指定關鍵字時，系統自動回覆對應素材"
      >
        <Button size="lg" onClick={handleOpenCreate}>
          <AddIcon />
          建立關鍵字回覆
        </Button>
      </Topbar>

      <div className="flex flex-1 flex-col gap-5 overflow-auto px-7 pb-7">
        <details className="group rounded-lg border border-border bg-background">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <Info className="h-4 w-4 text-primary" aria-hidden="true" />
            怎麼用？
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground">
              <li>
                先到「<Link href="/dashboard/marketing/materials" className="text-primary underline underline-offset-2 hover:text-primary-hover">行銷 &gt; 素材庫</Link>」建立要回覆的內容（純文字、圖片、Flex、輪播都行）
              </li>
              <li>回來這頁按「建立關鍵字回覆」，輸入規則名稱、關鍵字（一個或多個）、選素材</li>
              <li>顧客在 LINE 傳訊息含關鍵字 → 自動回覆對應素材</li>
            </ol>
            <div role="note" className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-amber-800">
              <p className="mb-1 font-semibold">注意事項</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>只在機器人處理中的對話觸發，已由客服接手的對話不會自動回覆</li>
                <li>每位聯繫人對同一條規則，1 小時內最多觸發 3 次（避免洗版）</li>
              </ul>
            </div>
          </div>
        </details>

        {isLoading ? (
          <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <span key={i} className="block h-14 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : replies.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
            <span className="text-sm text-muted-foreground">尚未建立任何關鍵字回覆</span>
            <Button onClick={handleOpenCreate}>
              <AddIcon />
              建立第一條規則
            </Button>
          </div>
        ) : (
          <>
            <div role="table" aria-label="關鍵字回覆規則" className="overflow-x-auto rounded-lg border border-border">
              <div className="min-w-[900px]">
                <div role="row" className={`${COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
                  <span role="columnheader">狀態</span>
                  <span role="columnheader">規則名稱</span>
                  <span role="columnheader">關鍵字</span>
                  <span role="columnheader">回覆素材</span>
                  <span role="columnheader" className="text-right">動作</span>
                </div>
                {replies.map((r) => {
                  const mat = materialMap.get(r.materialId);
                  return (
                    <div key={r.id} role="row" className={`${COLS} border-b border-border bg-background py-3.5 text-sm transition-colors last:border-b-0 hover:bg-surface-hover`}>
                      {/* 停用不再整列變淡（對比不足），改用開關＋文字表示 */}
                      <span role="cell" className="flex items-center gap-2">
                        <Switch
                          checked={r.isActive}
                          onCheckedChange={() => handleToggle(r)}
                          aria-label={`${r.isActive ? '停用' : '啟用'}「${r.name}」`}
                        />
                        <span className={r.isActive ? 'text-foreground' : 'text-muted-foreground'}>{r.isActive ? '啟用' : '停用'}</span>
                      </span>
                      <span role="cell" className="truncate font-semibold text-foreground" title={r.name}>{r.name}</span>
                      <span role="cell" className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {r.keywords.slice(0, 3).map((k, i) => (
                          <span key={i} className="inline-flex h-6 max-w-[160px] items-center rounded-full border border-primary-border bg-primary-subtle px-2.5 text-xs text-primary" title={k}>
                            <span className="truncate">{k}</span>
                          </span>
                        ))}
                        {r.keywords.length > 3 && <span className="text-xs text-muted-foreground">+{r.keywords.length - 3}</span>}
                        {r.keywords.length > 1 && <span className="text-xs text-muted-foreground">（{r.matchMode === 'all' ? '全部' : '任一'}）</span>}
                      </span>
                      <span role="cell" className="flex min-w-0 flex-col">
                        {mat ? (
                          <>
                            <span className="truncate text-foreground" title={mat.name}>{mat.name}</span>
                            <span className="text-xs text-muted-foreground">{CONTENT_TYPE_LABEL[mat.contentType] ?? mat.contentType}</span>
                          </>
                        ) : (
                          <span className="text-xs text-warning">素材已刪除或停用</span>
                        )}
                      </span>
                      <span role="cell" className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="xs" onClick={() => handleOpenEdit(r)} aria-label={`編輯「${r.name}」`}>
                          <EditIcon />
                          編輯
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => handleDelete(r.id)} aria-label={`刪除「${r.name}」`} title="刪除">
                          <DeleteIcon />
                        </Button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">共 {replies.length} 條規則</p>
          </>
        )}
      </div>

      <KeywordReplyEditDialog
        open={dialogOpen}
        reply={editing}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
