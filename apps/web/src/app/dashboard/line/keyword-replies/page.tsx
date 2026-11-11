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
import { ChevronDown, Info } from 'lucide-react';
import Link from 'next/link';
import { Switch } from '@/components/ui/switch';
import { AddIcon, DeleteIcon, EditIcon } from '@/components/icons/figma-icons';
import { KeywordReplyMaterialCell } from '@/components/line/keyword-reply/KeywordReplyMaterialCell';
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

// 欄寬依 Claude Design：狀態、規則名稱、渠道、關鍵字、回覆素材、優惠券、動作（固定欄寬，避免文字被擠成直排）
const COLS = 'grid grid-cols-[120px_minmax(140px,1fr)_120px_minmax(200px,1.3fr)_minmax(150px,1fr)_minmax(140px,1fr)_150px] items-center gap-4 px-5';

type ChannelFilter = 'ALL' | KeywordReplyChannel;

/** 列表的渠道欄（change add-fb-ig-keyword-coupon，取自 main） */
function ChannelCell({ reply }: { reply: KeywordReply }) {
  if (reply.channel) {
    return (
      <span className="inline-flex h-6 items-center rounded-full border border-border bg-muted px-2.5 text-xs font-medium text-foreground">
        {keywordReplyChannelLabel(reply.channel)}
      </span>
    );
  }
  if (reply.channelIssue) {
    return (
      <a href={`/dashboard/automation/${reply.id}`} className="text-xs text-warning underline underline-offset-2">
        渠道條件請到自動化規則編輯
      </a>
    );
  }
  return <span className="text-xs text-muted-foreground">未限定渠道</span>;
}

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

  // 版面依 Claude Design「關鍵字回覆」：標題列＋建立、可收合的使用說明、渠道篩選、規則列表、總數。
  // 渠道篩選／渠道欄／優惠券欄與使用說明的觸發規則取自 main（M11：不看對話狀態、沒有次數上限）。
  return (
    <div className="flex h-full flex-col">
      <Topbar
        title="關鍵字回覆"
        description="顧客在 LINE、Facebook 或 Instagram 傳送的訊息出現指定關鍵字時，系統自動回覆對應素材，也可以同時發送優惠券"
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
              <li>回來這頁按「建立關鍵字回覆」，選渠道（LINE、Facebook、Instagram），輸入規則名稱、關鍵字（一個或多個），選素材或要發送的優惠券（至少一個）。Instagram 目前沒有素材，只能發券</li>
              <li>顧客在所選渠道傳訊息含關鍵字 → 自動回覆對應素材、發送優惠券；券沒有發出時，原因會記在該對話中</li>
            </ol>
            <div role="note" className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-amber-800">
              <p className="mb-1 font-semibold">注意事項</p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>客人每傳一則含關鍵字的訊息就會觸發一次，沒有次數上限；客服接手的對話也會自動回覆</li>
                <li>比對方式是「包含」且不分大小寫，例如關鍵字「價」也會命中「評價」，關鍵字請盡量具體</li>
                <li>每條規則只在所選渠道的對話觸發，並對這個渠道的所有帳號生效（例如所有 LINE 官方帳號、所有粉專）；命中的規則能在這個對話的渠道送出回覆時，AI 就不再另外回覆</li>
                <li>Facebook 與 Instagram 的顧客開啟票券時以 email 驗證身分</li>
              </ul>
            </div>
          </div>
        </details>

        {/* 渠道篩選（change add-fb-ig-keyword-coupon design D1，取自 main）；樣式同報表的分段按鈕 */}
        <div role="group" aria-label="依渠道篩選" className="flex h-10 items-center gap-1 self-start rounded-md border border-border bg-muted p-1">
          {([{ value: 'ALL', label: '全部' }, ...KEYWORD_REPLY_CHANNELS] as Array<{ value: ChannelFilter; label: string }>).map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={channelFilter === c.value}
              onClick={() => setChannelFilter(c.value)}
              className={`flex h-8 items-center rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                channelFilter === c.value ? 'bg-primary font-semibold text-white' : 'text-foreground hover:bg-black/5'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

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
        ) : visibleReplies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            這個渠道還沒有關鍵字回覆
          </div>
        ) : (
          <>
            <div role="table" aria-label="關鍵字回覆規則" className="overflow-x-auto rounded-lg border border-border">
              <div className="min-w-[1180px]">
                <div role="row" className={`${COLS} border-b border-border bg-muted py-2 text-sm font-medium leading-7 text-muted-foreground`}>
                  <span role="columnheader">狀態</span>
                  <span role="columnheader">規則名稱</span>
                  <span role="columnheader">渠道</span>
                  <span role="columnheader">關鍵字</span>
                  <span role="columnheader">回覆素材</span>
                  <span role="columnheader">優惠券</span>
                  <span role="columnheader" className="text-right">動作</span>
                </div>
                {visibleReplies.map((r) => {
                  const mat = r.materialId ? materialMap.get(r.materialId) : undefined;
                  const coupon = r.couponId ? couponMap.get(r.couponId) : undefined;
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
                      <span role="cell"><ChannelCell reply={r} /></span>
                      <span role="cell" className="flex min-w-0 flex-wrap items-center gap-1.5">
                        {r.keywords.slice(0, 3).map((k, i) => (
                          <span key={i} className="inline-flex h-6 max-w-[160px] items-center rounded-full border border-primary-border bg-primary-subtle px-2.5 text-xs text-primary" title={k}>
                            <span className="truncate">{k}</span>
                          </span>
                        ))}
                        {r.keywords.length > 3 && <span className="text-xs text-muted-foreground">+{r.keywords.length - 3}</span>}
                        {r.keywords.length > 1 && <span className="text-xs text-muted-foreground">（{r.matchMode === 'all' ? '全部' : '任一'}）</span>}
                      </span>
                      {/* 素材狀態（渠道不符、已刪除、已停用）由 main 的 KeywordReplyMaterialCell 判斷 */}
                      <span role="cell" className="min-w-0"><KeywordReplyMaterialCell reply={r} material={mat} /></span>
                      <span role="cell" className="min-w-0 text-sm">
                        {!r.couponId ? (
                          <span className="text-muted-foreground">—</span>
                        ) : coupon?.status === 'ACTIVE' ? (
                          <span className="truncate text-foreground">{couponOptionLabel(coupon)}</span>
                        ) : (
                          <span className="text-xs text-warning">
                            {coupon ? `${coupon.name}：` : ''}{UNAVAILABLE_COUPON_LABEL}
                          </span>
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
            <p className="text-sm text-muted-foreground">共 {visibleReplies.length} 條規則</p>
          </>
        )}
      </div>

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
