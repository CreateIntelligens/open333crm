'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMaterials } from '@/hooks/useMaterials';
import { CouponSelectField } from '@/components/coupons/CouponSelectField';
import {
  CHANNEL_ISSUE_MESSAGE,
  KEYWORD_REPLY_CHANNELS,
  keywordReplyChannelLabel,
  keywordReplySaveBlock,
  materialIssueOf,
  materialIssueMessage,
  type KeywordReply,
  type KeywordReplyChannel,
  type KeywordReplyInput,
} from '@/hooks/useKeywordReplies';

interface Props {
  open: boolean;
  reply: KeywordReply | null; // null = 新建
  /** 新建時預設的渠道（列表目前篩選的渠道）；沒有時為 LINE */
  defaultChannel?: KeywordReplyChannel;
  onClose: () => void;
  onSave: (input: KeywordReplyInput) => Promise<void>;
}

export function KeywordReplyEditDialog({ open, reply, defaultChannel, onClose, onSave }: Props) {
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any');
  const [channel, setChannel] = useState<KeywordReplyChannel>('LINE');
  const [materialId, setMaterialId] = useState('');
  const [couponId, setCouponId] = useState('');
  const [failureText, setFailureText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 只列所選渠道的素材；Instagram 沒有素材（素材庫只有 LINE、Facebook，design D5）
  const channelInfo = KEYWORD_REPLY_CHANNELS.find((c) => c.value === channel) ?? KEYWORD_REPLY_CHANNELS[0];
  const { materials: channelMaterials } = useMaterials({ channelType: channelInfo.materialChannelType ?? 'threads', isActive: true, limit: 200 });
  const materials = channelInfo.materialChannelType ? channelMaterials : [];
  // 已有渠道條件的規則不能改渠道（design D4）
  const channelLocked = !!reply?.channel;

  useEffect(() => {
    if (open) {
      setName(reply?.name ?? '');
      setKeywords(reply?.keywords ?? []);
      setMatchMode(reply?.matchMode ?? 'any');
      setChannel(reply ? reply.defaultChannel : (defaultChannel ?? 'LINE'));
      setMaterialId(reply?.materialId ?? '');
      setCouponId(reply?.couponId ?? '');
      setFailureText(reply?.failureText ?? '');
      setDraftKeyword('');
      setError(null);
    }
  }, [open, reply, defaultChannel]);

  if (!open) return null;

  const handleAddKeyword = () => {
    const k = draftKeyword.trim();
    if (!k) return;
    if (keywords.includes(k)) return;
    setKeywords([...keywords, k]);
    setDraftKeyword('');
  };

  const handleRemoveKeyword = (idx: number) => {
    setKeywords(keywords.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('請輸入規則名稱'); return; }
    if (keywords.length === 0) { setError('至少要 1 個關鍵字'); return; }
    // 素材改為選填（add-coupon-system design D25），但素材與優惠券至少要選一個
    if (!materialId && !couponId) { setError('回覆素材與優惠券至少要選一個'); return; }
    // 原本的素材不能在所選渠道使用（或已刪除、停用）且沒有改選：存檔會加上渠道條件讓規則不再送出，擋下
    const blocked = keywordReplySaveBlock(reply, { channel, materialId: materialId || null });
    if (blocked) { setError(blocked); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        channel,
        keywords,
        matchMode,
        materialId: materialId || null,
        couponId: couponId || null,
        failureText: couponId ? failureText.trim() : '',
      });
      onClose();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError(((err as any)?.response?.data?.error?.message) ?? (err instanceof Error && err.message ? err.message : '儲存失敗'));
    } finally {
      setSaving(false);
    }
  };

  const selectedMaterial = materials.find((m) => m.id === materialId);
  // 原本的素材在所選渠道能不能用：改選渠道後重新判斷
  const originalMaterialIssue = reply?.materialId && materialId === reply.materialId
    ? materialIssueOf(reply.materialLookup, channel) ?? null
    : null;

  const handleChannelChange = (next: KeywordReplyChannel) => {
    setChannel(next);
    // 換渠道時清掉不屬於新渠道的素材選擇；規則原本的素材保留，由上方的說明與存檔防線處理
    if (materialId && materialId !== reply?.materialId) setMaterialId('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {reply ? '編輯關鍵字回覆' : '建立關鍵字回覆'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              顧客在所選渠道傳送的訊息出現指定關鍵字時，自動回覆對應素材，也可以同時發送優惠券
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          {reply?.channelIssue && (
            <div role="alert" className="rounded border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
              <p>{CHANNEL_ISSUE_MESSAGE}</p>
              <a href={`/dashboard/automation/${reply.id}`} className="mt-1 inline-block font-medium underline">
                到自動化規則編輯
              </a>
            </div>
          )}

          {/* 渠道（change add-fb-ig-keyword-coupon design D4） */}
          <div>
            {channelLocked ? (
              <>
                <div className="text-xs font-semibold text-muted-foreground">
                  渠道：{keywordReplyChannelLabel(channel)}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">渠道建立後不能更改；要換渠道請刪除後重新建立</p>
              </>
            ) : (
              <>
                <label htmlFor="keyword-reply-channel" className="mb-1 block text-xs font-semibold text-muted-foreground">
                  渠道
                </label>
                <select
                  id="keyword-reply-channel"
                  value={channel}
                  onChange={(e) => handleChannelChange(e.target.value as KeywordReplyChannel)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {KEYWORD_REPLY_CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {reply && !reply.channel && !reply.channelIssue && (
                  <p className="mt-1 text-[11px] text-warning">這條規則原本沒有限定渠道，儲存後只在所選渠道的對話觸發</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  規則只在這個渠道的對話觸發，對這個渠道的所有帳號生效（例如所有 LINE 官方帳號或所有粉專）
                </p>
              </>
            )}
          </div>

          {/* 規則名稱 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              規則名稱 *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 200))}
              placeholder="例：詢問營業時間、預約諮詢、產品 DM"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">只給管理用，用戶不會看到</p>
          </div>

          {/* 關鍵字 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">
              關鍵字 *
            </label>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {keywords.map((k, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary-subtle px-2.5 py-1 text-xs text-primary"
                >
                  {k}
                  <button
                    type="button"
                    onClick={() => handleRemoveKeyword(idx)}
                    className="text-primary hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={draftKeyword}
                onChange={(e) => setDraftKeyword(e.target.value)}
                placeholder="輸入關鍵字後按 Enter 或點「加入」"
                className="flex-1 h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={handleAddKeyword}
                disabled={!draftKeyword.trim()}
              >
                <Plus className="mr-1 h-3 w-3" />
                加入
              </Button>
            </div>

            {/* match mode */}
            {keywords.length > 1 && (
              <div className="mt-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">比對方式</div>
                <div className="flex gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={matchMode === 'any'}
                      onChange={() => setMatchMode('any')}
                    />
                    任一關鍵字出現就觸發（OR）
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={matchMode === 'all'}
                      onChange={() => setMatchMode('all')}
                    />
                    所有關鍵字都要出現才觸發（AND）
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 素材選擇 */}
          <div>
            <label htmlFor="keyword-reply-material" className="mb-1 block text-xs font-semibold text-muted-foreground">
              回覆素材
            </label>
            {originalMaterialIssue && (
              <div role="alert" className="mb-2 rounded border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
                <p>{materialIssueMessage(originalMaterialIssue)}</p>
                {originalMaterialIssue.kind === 'other_channel' ? (
                  <a href={`/dashboard/automation/${reply!.id}`} className="mt-1 inline-block font-medium underline">
                    到自動化規則編輯
                  </a>
                ) : (
                  <p className="mt-1">改選一個{channelInfo.label}素材，或拿掉素材只發券，就可以儲存。</p>
                )}
              </div>
            )}
            <select
              id="keyword-reply-material"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              disabled={!channelInfo.materialChannelType && !materialId}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— 請選擇 —</option>
              {/* 規則原本的素材不在這個渠道的清單時仍保留選項，才看得出原本選的是什麼 */}
              {reply?.materialId && materialId === reply.materialId && !materials.some((m) => m.id === reply.materialId) && (
                <option value={reply.materialId}>原本的素材（id: {reply.materialId.slice(0, 8)}…）</option>
              )}
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.contentType}）
                </option>
              ))}
            </select>
            {selectedMaterial && (
              <div className="mt-2 rounded border border-border bg-muted px-3 py-2 text-xs">
                <div className="font-medium">{selectedMaterial.name}</div>
                <div className="text-muted-foreground">
                  類型：{selectedMaterial.contentType}
                  {selectedMaterial.category ? ` · 分類：${selectedMaterial.category}` : ''}
                </div>
                {selectedMaterial.variables && selectedMaterial.variables.length > 0 && (
                  <div className="mt-1 text-warning">
                    此素材含 {selectedMaterial.variables.length} 個變數（{selectedMaterial.variables.map((v) => v.key).join(', ')}），送出時代入客人的聯絡人資料；客人沒有這項資料時用素材的預設值，沒有預設值則留空
                  </div>
                )}
              </div>
            )}
            {channelInfo.materialChannelType ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                素材在「行銷 → 素材庫」建立，這裡只列{channelInfo.label}渠道的素材。素材與優惠券至少要選一個
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">{channelInfo.label} 目前沒有素材，只能發券</p>
            )}
          </div>

          {/* 優惠券（add-coupon-system design D25） */}
          <div className="space-y-3">
            <CouponSelectField
              id="keyword-reply-coupon"
              label="同時發送優惠券"
              value={couponId}
              onChange={setCouponId}
            />
            <p className="-mt-2 text-[11px] text-muted-foreground">
              只列進行中的券。每位顧客依券的每人上限領取，發出的券會出現在收件匣與券的序號明細
            </p>
            {couponId && (
              <div>
                <label htmlFor="keyword-reply-failure-text" className="mb-1 block text-xs font-semibold text-muted-foreground">
                  發不出時回覆顧客
                </label>
                <textarea
                  id="keyword-reply-failure-text"
                  value={failureText}
                  onChange={(e) => setFailureText(e.target.value.slice(0, 500))}
                  rows={2}
                  placeholder="例：您已經領過這張券囉"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  選填。顧客已達領取上限、券已發完或暫停時送出這段文字；空白則不回覆。沒有發出的原因都會記在對話中
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
