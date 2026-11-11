'use client';

import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  PageDialog,
  PageDialogContent,
  PageDialogHeader,
  PageDialogTitle,
  PageDialogDescription,
  PageDialogFooter,
} from '@/components/ui/page-dialog';
import { useMaterials } from '@/hooks/useMaterials';
import { CouponSelectField } from '@/components/coupons/CouponSelectField';
import { bodyHasCouponUrl, COUPON_URL_IN_RULE_MESSAGE } from '@/lib/marketing/coupon-url';
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
    // 關鍵字回覆不會發券：素材的顧客專屬券連結會被拿掉，顧客拿不到券（後端也會擋）
    if (bodyHasCouponUrl(materials.find((m) => m.id === materialId)?.body)) { setError(COUPON_URL_IN_RULE_MESSAGE); return; }
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
  const selectedMaterialHasCouponUrl = bodyHasCouponUrl(selectedMaterial?.body);
  // 原本的素材在所選渠道能不能用：改選渠道後重新判斷
  const originalMaterialIssue = reply?.materialId && materialId === reply.materialId
    ? materialIssueOf(reply.materialLookup, channel) ?? null
    : null;

  const handleChannelChange = (next: KeywordReplyChannel) => {
    setChannel(next);
    // 換渠道時清掉不屬於新渠道的素材選擇；規則原本的素材保留，由上方的說明與存檔防線處理
    if (materialId && materialId !== reply?.materialId) setMaterialId('');
  };

  const CONTENT_TYPE_LABEL: Record<string, string> = { text: '文字', image: '圖片', flex: 'Flex', carousel: '輪播', imagemap: '圖文', video: '影片' };

  // 依 Claude Design「關鍵字回覆」：改為下一頁式表單（原本是自製的跳出視窗，沒有焦點管理、欄位名稱也沒綁定輸入框）
  return (
    <PageDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} section="渠道" parent="關鍵字回覆">
      <PageDialogContent>
        <PageDialogHeader>
          <PageDialogTitle>{reply ? '編輯關鍵字回覆' : '建立關鍵字回覆'}</PageDialogTitle>
          <PageDialogDescription>顧客在所選渠道傳送的訊息出現指定關鍵字時，自動回覆對應素材，也可以同時發送優惠券</PageDialogDescription>
        </PageDialogHeader>

        <div className="flex flex-col gap-6">

          {reply?.channelIssue && (
            <div role="alert" className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-amber-800">
              <p>{CHANNEL_ISSUE_MESSAGE}</p>
              <a href={`/dashboard/automation/${reply.id}`} className="mt-1 inline-block font-medium underline underline-offset-2">
                到自動化規則編輯
              </a>
            </div>
          )}

          {/* 渠道（change add-fb-ig-keyword-coupon design D4，取自 main） */}
          <div className="flex flex-col gap-1.5">
            {channelLocked ? (
              <>
                <span className="text-sm font-medium text-foreground">渠道：{keywordReplyChannelLabel(channel)}</span>
                <p className="text-xs text-muted-foreground">渠道建立後不能更改；要換渠道請刪除後重新建立</p>
              </>
            ) : (
              <>
                <label htmlFor="keyword-reply-channel" className="text-sm font-medium text-foreground">渠道</label>
                <Select
                  id="keyword-reply-channel"
                  value={channel}
                  onChange={(e) => handleChannelChange(e.target.value as KeywordReplyChannel)}
                  options={KEYWORD_REPLY_CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
                />
                {reply && !reply.channel && !reply.channelIssue && (
                  <p className="text-xs text-warning">這條規則原本沒有限定渠道，儲存後只在所選渠道的對話觸發</p>
                )}
                <p className="text-xs text-muted-foreground">
                  規則只在這個渠道的對話觸發，對這個渠道的所有帳號生效（例如所有 LINE 官方帳號或所有粉專）
                </p>
              </>
            )}
          </div>

          {/* 規則名稱 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kr-name" className="text-sm font-medium text-foreground">
              規則名稱<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </label>
            <Input
              id="kr-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 200))}
              placeholder="例：詢問營業時間、預約諮詢、產品 DM"
              aria-required="true"
              aria-describedby="kr-name-hint"
            />
            <p id="kr-name-hint" className="text-xs text-muted-foreground">只給管理用，顧客不會看到</p>
          </div>

          {/* 關鍵字 */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kr-keyword" className="text-sm font-medium text-foreground">
              關鍵字<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">至少 1 個</span>
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="kr-keyword"
                value={draftKeyword}
                onChange={(e) => setDraftKeyword(e.target.value)}
                placeholder="輸入關鍵字後按 Enter 或點「加入」"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddKeyword();
                  }
                }}
              />
              <Button variant="outline" size="lg" onClick={handleAddKeyword} disabled={!draftKeyword.trim()}>
                <Plus />
                加入
              </Button>
            </div>
            {keywords.length > 0 && (
              <ul aria-label="已加入的關鍵字" className="flex flex-wrap items-center gap-1.5 pt-1">
                {keywords.map((k, idx) => (
                  <li key={idx} className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-primary-border bg-primary-subtle py-1 pl-3 pr-1.5 text-sm text-primary">
                    <span className="truncate" title={k}>{k}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveKeyword(idx)}
                      aria-label={`移除關鍵字「${k}」`}
                      className="flex h-5 w-5 flex-none items-center justify-center rounded-full hover:bg-primary/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 比對方式：2 個以上關鍵字才出現 */}
          {keywords.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium text-foreground">比對方式</legend>
              {([
                ['any', '任一關鍵字符合就觸發'],
                ['all', '全部關鍵字都出現才觸發'],
              ] as const).map(([value, label]) => (
                <label key={value} className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input type="radio" name="kr-match" checked={matchMode === value} onChange={() => setMatchMode(value)} className="h-4 w-4 accent-primary" />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          {/* 回覆素材（素材改為選填，與優惠券至少選一個；取自 main） */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="keyword-reply-material" className="text-sm font-medium text-foreground">回覆素材</label>
            {originalMaterialIssue && (
              <div role="alert" className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-amber-800">
                <p>{materialIssueMessage(originalMaterialIssue)}</p>
                {originalMaterialIssue.kind === 'other_channel' ? (
                  <a href={`/dashboard/automation/${reply!.id}`} className="mt-1 inline-block font-medium underline underline-offset-2">
                    到自動化規則編輯
                  </a>
                ) : (
                  <p className="mt-1">改選一個{channelInfo.label}素材，或拿掉素材只發券，就可以儲存。</p>
                )}
              </div>
            )}
            <Select
              id="keyword-reply-material"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              disabled={!channelInfo.materialChannelType && !materialId}
              aria-describedby="kr-material-hint"
              options={[
                { value: '', label: '— 請選擇 —' },
                // 規則原本的素材不在這個渠道的清單時仍保留選項，才看得出原本選的是什麼
                ...(reply?.materialId && materialId === reply.materialId && !materials.some((m) => m.id === reply.materialId)
                  ? [{ value: reply.materialId, label: `原本的素材（id: ${reply.materialId.slice(0, 8)}…）` }]
                  : []),
                ...materials.map((m) => ({ value: m.id, label: `${m.name}（${CONTENT_TYPE_LABEL[m.contentType] ?? m.contentType}）` })),
              ]}
            />
            {selectedMaterialHasCouponUrl && (
              <p role="alert" className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-amber-800">
                {COUPON_URL_IN_RULE_MESSAGE}
              </p>
            )}
            {selectedMaterial?.variables && selectedMaterial.variables.length > 0 && (
              <p role="note" className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-amber-800">
                此素材含 {selectedMaterial.variables.length} 個變數（{selectedMaterial.variables.map((v) => v.key).join('、')}），送出時代入客人的聯絡人資料；客人沒有這項資料時用素材的預設值，沒有預設值則留空
              </p>
            )}
            {channelInfo.materialChannelType ? (
              <p id="kr-material-hint" className="text-xs text-muted-foreground">
                素材在「行銷 &gt; 素材庫」建立，這裡只列{channelInfo.label}渠道的素材。素材與優惠券至少要選一個
              </p>
            ) : (
              <p id="kr-material-hint" className="text-xs text-muted-foreground">{channelInfo.label} 目前沒有素材，只能發券</p>
            )}
          </div>

          {/* 優惠券（add-coupon-system design D25，取自 main） */}
          <div className="flex flex-col gap-3">
            <CouponSelectField
              id="keyword-reply-coupon"
              label="同時發送優惠券"
              value={couponId}
              onChange={setCouponId}
            />
            <p className="-mt-2 text-xs text-muted-foreground">
              只列進行中的券。每位顧客依券的每人上限領取，發出的券會出現在收件匣與券的序號明細
            </p>
            {couponId && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="keyword-reply-failure-text" className="text-sm font-medium text-foreground">
                  發不出時回覆顧客
                </label>
                <Textarea
                  id="keyword-reply-failure-text"
                  value={failureText}
                  onChange={(e) => setFailureText(e.target.value.slice(0, 500))}
                  rows={2}
                  placeholder="例：您已經領過這張券囉"
                />
                <p className="text-xs text-muted-foreground">
                  選填。顧客已達領取上限、券已發完或暫停時送出這段文字；空白則不回覆。沒有發出的原因都會記在對話中
                </p>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <PageDialogFooter>
          <Button variant="outline" size="lg" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="lg" onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </PageDialogFooter>
      </PageDialogContent>
    </PageDialog>
  );
}
