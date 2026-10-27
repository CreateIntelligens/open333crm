'use client';

/**
 * 關鍵字回覆管理頁（LINE、Facebook、Instagram）
 *
 * 顧客傳訊息含關鍵字時 → 自動回對應素材，也可以同時發送優惠券。
 * 底層走 automation rules（keyword.matched + send_material／issue_coupon，帶「對話渠道等於所選渠道」條件）。
 * 網址仍是 /dashboard/line/keyword-replies：手冊、E2E 與書籤都連到這裡，畫面上不再寫「LINE 關鍵字回覆」
 * （change add-fb-ig-keyword-coupon design D1）。
 */

import React, { useState } from 'react';
import { Plus, Edit, Trash2, Power, PowerOff, Info } from 'lucide-react';
import { Topbar } from '@/components/layout/Topbar';
import { Button } from '@/components/ui/button';
import { KeywordReplyEditDialog } from '@/components/line/keyword-reply/KeywordReplyEditDialog';
import { useMaterials } from '@/hooks/useMaterials';
import { UNAVAILABLE_COUPON_LABEL, couponOptionLabel, useCouponOptions } from '@/components/coupons/CouponSelectField';
import {
  KEYWORD_REPLY_CHANNELS,
  keywordReplyChannelLabel,
  useKeywordReplies,
  createKeywordReply,
  updateKeywordReply,
  deleteKeywordReply,
  toggleKeywordReply,
  type KeywordReply,
  type KeywordReplyChannel,
} from '@/hooks/useKeywordReplies';

type ChannelFilter = 'ALL' | KeywordReplyChannel;

/** 列表的渠道欄 */
function ChannelCell({ reply }: { reply: KeywordReply }) {
  if (reply.channel) {
    return (
      <span className="inline-flex rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium">
        {keywordReplyChannelLabel(reply.channel)}
      </span>
    );
  }
  if (reply.channelIssue) {
    return (
      <a href={`/dashboard/automation/${reply.id}`} className="text-[11px] text-warning underline">
        渠道條件請到自動化規則編輯
      </a>
    );
  }
  return <span className="text-[11px] text-muted-foreground">未限定渠道</span>;
}
import { KeywordReplyMaterialCell } from '@/components/line/keyword-reply/KeywordReplyMaterialCell';

export default function KeywordRepliesPage() {
  const { replies, isLoading, mutate } = useKeywordReplies();
  // 各渠道的素材都要顯示名稱，不限渠道
  const { materials } = useMaterials({ isActive: true, limit: 200 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KeywordReply | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
  const visibleReplies = channelFilter === 'ALL' ? replies : replies.filter((r) => r.channel === channelFilter);

  const { coupons } = useCouponOptions();
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const couponMap = new Map(coupons.map((c) => [c.id, c]));

  const handleOpenCreate = () => { setEditing(null); setDialogOpen(true); };
  const handleOpenEdit = (r: KeywordReply) => { setEditing(r); setDialogOpen(true); };

  const handleSave = async (input: Parameters<typeof createKeywordReply>[0]) => {
    if (editing) {
      await updateKeywordReply(editing, input);
    } else {
      await createKeywordReply(input);
    }
    await mutate();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除這條關鍵字回覆？')) return;
    try {
      await deleteKeywordReply(id);
      await mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '刪除失敗');
    }
  };

  const handleToggle = async (r: KeywordReply) => {
    try {
      await toggleKeywordReply(r.id, !r.isActive);
      await mutate();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alert(((err as any)?.response?.data?.error?.message) ?? '更新失敗');
    }
  };

  return (
    <div className="flex h-screen flex-col bg-muted">
      <Topbar title="渠道" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">關鍵字回覆</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                顧客在 LINE、Facebook 或 Instagram 傳送的訊息出現指定關鍵字時，系統自動回覆對應素材，也可以同時發送優惠券。
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
              <li>回來這頁按「建立關鍵字回覆」，選渠道（LINE、Facebook、Instagram），輸入規則名稱、關鍵字（一個或多個），選素材或要發送的優惠券（至少一個）。Instagram 目前沒有素材，只能發券</li>
              <li>顧客在所選渠道傳訊息含關鍵字 → 自動回覆對應素材、發送優惠券；券沒有發出時，原因會記在該對話中</li>
            </ol>
            <div className="mt-2 rounded border border-warning/30 bg-warning-subtle px-3 py-1.5 text-xs text-warning">
              客人每傳一則含關鍵字的訊息就會觸發一次，沒有次數上限；客服接手的對話也會自動回覆。比對方式是「包含」且不分大小寫，例如關鍵字「價」也會命中「評價」，關鍵字請盡量具體。每條規則只在所選渠道的對話觸發，並對這個渠道的所有帳號生效（例如所有 LINE 官方帳號、所有粉專）；命中的規則能在這個對話的渠道送出回覆時，AI 就不再另外回覆。Facebook 與 Instagram 的顧客開啟票券時以 email 驗證身分。
            </div>
          </section>

          {/* 渠道篩選（change add-fb-ig-keyword-coupon design D1） */}
          <div role="group" aria-label="依渠道篩選" className="flex flex-wrap gap-1.5">
            {([{ value: 'ALL', label: '全部' }, ...KEYWORD_REPLY_CHANNELS] as Array<{ value: ChannelFilter; label: string }>).map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={channelFilter === c.value}
                onClick={() => setChannelFilter(c.value)}
                className={
                  channelFilter === c.value
                    ? 'rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                    : 'rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground hover:text-foreground'
                }
              >
                {c.label}
              </button>
            ))}
          </div>

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

          {!isLoading && replies.length > 0 && visibleReplies.length === 0 && (
            <div className="rounded-lg border border-dashed border-input bg-white py-10 text-center text-sm text-muted-foreground">
              這個渠道還沒有關鍵字回覆
            </div>
          )}

          {!isLoading && visibleReplies.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">狀態</th>
                    <th className="px-4 py-2 text-left font-medium">規則名稱</th>
                    <th className="px-4 py-2 text-left font-medium">渠道</th>
                    <th className="px-4 py-2 text-left font-medium">關鍵字</th>
                    <th className="px-4 py-2 text-left font-medium">回覆素材</th>
                    <th className="px-4 py-2 text-left font-medium">優惠券</th>
                    <th className="px-4 py-2 text-right font-medium">動作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleReplies.map((r) => {
                    const mat = r.materialId ? materialMap.get(r.materialId) : undefined;
                    const coupon = r.couponId ? couponMap.get(r.couponId) : undefined;
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
                          <ChannelCell reply={r} />
                        </td>
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
                          <KeywordReplyMaterialCell reply={r} material={mat} />
                        </td>
                        <td className="px-4 py-3">
                          {!r.couponId ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : coupon?.status === 'ACTIVE' ? (
                            <span className="text-xs font-medium">{couponOptionLabel(coupon)}</span>
                          ) : (
                            <span className="text-xs text-warning">
                              {coupon ? `${coupon.name}：` : ''}{UNAVAILABLE_COUPON_LABEL}
                            </span>
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
        defaultChannel={channelFilter === 'ALL' ? undefined : channelFilter}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </div>
  );
}
