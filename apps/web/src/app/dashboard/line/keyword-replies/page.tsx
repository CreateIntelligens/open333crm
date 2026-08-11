'use client';

/**
 * LINE 關鍵字回覆管理頁
 *
 * 用戶傳訊息含關鍵字時 → 自動回對應素材。
 * 底層走 automation rules (keyword.matched + send_material)。
 */

import React, { useState } from 'react';
import { Plus, Edit, Trash2, Power, PowerOff, Info } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { LineModuleTabs } from '@/components/line/LineModuleTabs';
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

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="LINE 管理" />
      <LineModuleTabs active="keyword-replies" />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">關鍵字回覆</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                用戶在 LINE 傳訊息中出現指定關鍵字時，系統自動回覆對應素材（圖片 / Flex / 輪播 / 圖文等）。
              </p>
            </div>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-1 h-4 w-4" />
              建立關鍵字回覆
            </Button>
          </header>

          {/* 說明 */}
          <section className="rounded-lg border border-border bg-white p-4">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Info className="h-4 w-4 text-primary" />
              怎麼用？
            </div>
            <ol className="ml-1 mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>先到「<a href="/dashboard/marketing/materials" className="text-primary underline">行銷 → 素材庫</a>」建立你要回覆的內容（純文字、圖片、Flex、輪播都行）</li>
              <li>回來這頁按「建立關鍵字回覆」，輸入規則名稱、關鍵字（一個或多個）、選素材</li>
              <li>用戶在 LINE 傳訊息含關鍵字 → bot 自動回覆對應素材</li>
            </ol>
            <div className="mt-2 rounded border border-warning/30 bg-warning-subtle px-3 py-1.5 text-xs text-warning">
              ⚙️ 這條規則跑在 bot 模式（BOT_HANDLED 狀態的對話）才會觸發。已被客服接管的對話不會自動回。每個聯絡人對同一條規則 1 小時最多觸發 3 次（防轟炸）。
            </div>
          </section>

          {isLoading && (
            <div className="py-12 text-center text-sm text-muted-foreground">載入中…</div>
          )}

          {!isLoading && replies.length === 0 && (
            <div className="rounded-lg border border-dashed border-input bg-white py-16 text-center">
              <div className="text-sm text-muted-foreground">尚未建立任何關鍵字回覆</div>
              <Button className="mt-3" onClick={handleOpenCreate}>
                <Plus className="mr-1 h-4 w-4" />
                建立第一條
              </Button>
            </div>
          )}

          {!isLoading && replies.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">狀態</th>
                    <th className="px-4 py-2 text-left font-medium">規則名稱</th>
                    <th className="px-4 py-2 text-left font-medium">關鍵字</th>
                    <th className="px-4 py-2 text-left font-medium">回覆素材</th>
                    <th className="px-4 py-2 text-right font-medium">動作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {replies.map((r) => {
                    const mat = materialMap.get(r.materialId);
                    return (
                      <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleToggle(r)}
                            title={r.isActive ? '已啟用（點擊停用）' : '已停用（點擊啟用）'}
                            className={
                              r.isActive
                                ? 'inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-xs text-success'
                                : 'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                            }
                          >
                            {r.isActive ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                            {r.isActive ? '啟用' : '停用'}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium">{r.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {r.keywords.slice(0, 5).map((k, idx) => (
                              <span
                                key={idx}
                                className="inline-flex rounded-full border border-primary-border bg-primary-subtle px-2 py-0.5 text-[11px] text-primary"
                              >
                                {k}
                              </span>
                            ))}
                            {r.keywords.length > 5 && (
                              <span className="text-[11px] text-muted-foreground">+{r.keywords.length - 5}</span>
                            )}
                            {r.keywords.length > 1 && (
                              <span className="text-[11px] text-muted-foreground">
                                ({r.matchMode === 'all' ? '全部' : '任一'})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {mat ? (
                            <div>
                              <div className="text-xs font-medium">{mat.name}</div>
                              <div className="text-[11px] text-muted-foreground">{mat.contentType}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-destructive">素材已被刪除（id: {r.materialId.slice(0, 8)}…）</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(r)}>
                            <Edit className="mr-1 h-3 w-3" />編輯
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive-subtle hover:text-destructive"
                            onClick={() => handleDelete(r.id)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />刪除
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <KeywordReplyEditDialog
        open={dialogOpen}
        reply={editing}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
