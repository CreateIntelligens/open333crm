'use client';

/**
 * 券詳情頁「發送給…」（add-coupon-system design D31）：選一個渠道與對象（搜尋聯絡人勾選、標籤、分眾，
 * 最多 1,000 人）、選填訊息文字。送出前顯示可送達人數、剩餘名額與已達上限人數；名額不足時要確認才能送出。
 * 送出後建立一則附券廣播，由排程在背景發送，結果在「發放紀錄」查看。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { useChannels } from '@/hooks/useChannels';
import { useContactTags } from '@/hooks/useContactTags';
import { useSegments } from '@/hooks/useMarketing';
import {
  createCouponBatchIssue,
  previewCouponBatchIssue,
  type BatchIssueAudience,
} from '@/hooks/useCouponBatchIssue';
import {
  BATCH_ISSUE_MAX_RECIPIENTS,
  COUPON_PUSH_CHANNEL_TYPES,
  couponCapacityWarning,
  type CouponAudiencePreview,
} from '@/lib/marketing/coupon-broadcast';
import { channelOptionLabel } from '@/lib/marketing/broadcast-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type TargetType = BatchIssueAudience['targetType'];

interface ContactOption {
  id: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
}

export interface CouponBatchIssueDialogProps {
  couponId: string;
  couponName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已排入發送 */
  onQueued: (result: { broadcastId: string; name: string }) => void;
}

const TARGET_OPTIONS: Array<{ value: TargetType; label: string }> = [
  { value: 'contacts', label: '搜尋聯絡人勾選' },
  { value: 'tags', label: '依標籤' },
  { value: 'segment', label: '受眾分群' },
];

export function CouponBatchIssueDialog({ couponId, couponName, open, onOpenChange, onQueued }: CouponBatchIssueDialogProps) {
  const { channels, error: channelsError } = useChannels();
  const { tags, error: tagsError, mutate: reloadTags } = useContactTags();
  const { segments, error: segmentsError } = useSegments();

  const [channelId, setChannelId] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('contacts');
  const [picked, setPicked] = useState<ContactOption[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [segmentId, setSegmentId] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactOption[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CouponAudiencePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 每次開啟都從空白開始
  useEffect(() => {
    if (!open) return;
    setChannelId('');
    setTargetType('contacts');
    setPicked([]);
    setTagIds([]);
    setSegmentId('');
    setMessage('');
    setQuery('');
    setResults([]);
    setPreview(null);
    setSubmitError(null);
  }, [open]);

  // 只有能主動推送訊息的渠道（LINE、Facebook、Instagram）
  const pushChannels = useMemo(
    () => (channels as Array<{ id: string; displayName: string; channelType: string; isActive: boolean }>).filter(
      (c) => c.isActive && COUPON_PUSH_CHANNEL_TYPES.includes(c.channelType),
    ),
    [channels],
  );
  // 分眾需要行銷檢視權限；讀不到就不提供
  const targetOptions = segmentsError ? TARGET_OPTIONS.filter((o) => o.value !== 'segment') : TARGET_OPTIONS;

  // 搜尋聯絡人（停止輸入 300ms 後）
  useEffect(() => {
    if (targetType !== 'contacts' || query.trim().length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get(`/contacts?q=${encodeURIComponent(query.trim())}&limit=20`)
        .then((res) => {
          if (!cancelled) {
            setResults(res.data.data || []);
            setSearchError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setSearchError(getApiErrorMessage(err, '聯絡人搜尋失敗'));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, targetType]);

  const audience: BatchIssueAudience | null = useMemo(() => {
    if (!channelId) return null;
    if (targetType === 'contacts') return picked.length ? { channelId, targetType, contactIds: picked.map((p) => p.id) } : null;
    if (targetType === 'tags') return tagIds.length ? { channelId, targetType, tagIds } : null;
    return segmentId ? { channelId, targetType, segmentId } : null;
  }, [channelId, targetType, picked, tagIds, segmentId]);
  const audienceKey = JSON.stringify(audience);

  // 預覽可送達人數與名額
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setAcknowledged(false);
    if (!open || !audience) return;
    let cancelled = false;
    previewCouponBatchIssue(couponId, audience)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(getApiErrorMessage(err, '無法預估發送人數'));
      });
    return () => {
      cancelled = true;
    };
    // audience 以字串比較，避免每次重繪產生新物件就重新查詢
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, couponId, audienceKey]);

  const warning = couponCapacityWarning(preview);
  const tooMany = preview ? preview.reachable > BATCH_ISSUE_MAX_RECIPIENTS : false;
  const canSubmit = Boolean(audience && preview && !tooMany && preview.reachable > 0 && (!warning || acknowledged) && !submitting);

  function togglePick(c: ContactOption) {
    setPicked((prev) => {
      if (prev.some((p) => p.id === c.id)) return prev.filter((p) => p.id !== c.id);
      if (prev.length >= BATCH_ISSUE_MAX_RECIPIENTS) return prev;
      return [...prev, c];
    });
  }

  async function submit() {
    if (!audience || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createCouponBatchIssue(couponId, { ...audience, ...(message.trim() ? { message: message.trim() } : {}) });
      onQueued(result);
      onOpenChange(false);
    } catch (err: unknown) {
      setSubmitError(getApiErrorMessage(err, '送出失敗，券沒有發出，請重試'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)]">
        <DialogHeader>
          <DialogTitle>發送「{couponName}」給…</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label htmlFor="batch-issue-channel" className="mb-1 block font-medium">渠道</label>
            <Select
              id="batch-issue-channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              options={[
                { value: '', label: pushChannels.length ? '請選擇渠道' : '沒有可以發送的渠道' },
                ...pushChannels.map((c) => ({ value: c.id, label: channelOptionLabel(c) })),
              ]}
            />
            {channelsError && <p className="mt-1 text-xs text-destructive">渠道清單載入失敗，請重新整理</p>}
            <p className="mt-1 text-xs text-muted-foreground">每位對象各收到一張券與自己的票券連結；沒有這個渠道身分的人會跳過。</p>
          </div>

          <div>
            <label htmlFor="batch-issue-target" className="mb-1 block font-medium">對象</label>
            <Select
              id="batch-issue-target"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
              options={targetOptions}
            />
          </div>

          {targetType === 'contacts' && (
            <div className="space-y-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="輸入姓名、電話或 email 搜尋"
                aria-label="搜尋聯絡人"
              />
              {searchError && <p className="text-xs text-destructive">{searchError}</p>}
              {results.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {results.map((c) => (
                    <li key={c.id}>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={picked.some((p) => p.id === c.id)} onChange={() => togglePick(c)} />
                        <span>{c.displayName}</span>
                        {(c.phone || c.email) && <span className="text-xs text-muted-foreground">{c.phone || c.email}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {picked.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {p.displayName}
                      <button type="button" aria-label={`移除 ${p.displayName}`} onClick={() => togglePick(p)}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">已選 {picked.length} 人，最多 {BATCH_ISSUE_MAX_RECIPIENTS.toLocaleString()} 人</p>
            </div>
          )}

          {targetType === 'tags' && (
            <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-y-auto rounded-md border p-3">
              {tagsError ? (
                // 載入失敗不能顯示成「尚無標籤」，管理員會以為沒有標籤（PR #364 第四輪審查）
                <div role="alert" className="flex w-full items-center justify-between gap-3 text-xs text-destructive">
                  <span>標籤載入失敗：{getApiErrorMessage(tagsError, '請稍後再試')}</span>
                  <button type="button" className="shrink-0 font-medium underline" onClick={() => void reloadTags()}>
                    重試
                  </button>
                </div>
              ) : tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">尚無標籤</p>
              ) : (
                tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tagIds.includes(t.id)}
                      onChange={() => setTagIds((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                    />
                    {t.name}
                  </label>
                ))
              )}
            </div>
          )}

          {targetType === 'segment' && (
            <Select
              aria-label="受眾分群"
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              options={[
                { value: '', label: '請選擇分群' },
                ...(segments as Array<{ id: string; name: string }>).map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          )}

          <div>
            <label htmlFor="batch-issue-message" className="mb-1 block font-medium">訊息文字（選填）</label>
            <Textarea
              id="batch-issue-message"
              value={message}
              maxLength={500}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="沒填時使用預設的發券文字；有填時票券連結附在文字後"
            />
          </div>

          {previewError && <p className="text-xs text-destructive">{previewError}</p>}
          {preview && (
            <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-xs">
              <p className="font-medium">
                可送達 {preview.reachable} 人
                {preview.coupon?.remaining != null && `，剩餘名額 ${preview.coupon.remaining} 張`}
                {preview.coupon && preview.coupon.limitReached > 0 && `，${preview.coupon.limitReached} 人已達每人上限（不會收到）`}
              </p>
              {tooMany && <p className="text-destructive">超過 {BATCH_ISSUE_MAX_RECIPIENTS.toLocaleString()} 人，請縮小對象範圍</p>}
              {preview.reachable === 0 && <p className="text-destructive">所選對象在這個渠道都沒有可發送的身分</p>}
              {warning && (
                <>
                  <p className="text-warning">{warning}</p>
                  <label className="flex items-center gap-2 text-foreground">
                    <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                    我了解名額不足，仍要發送
                  </label>
                </>
              )}
            </div>
          )}
          {submitError && <p role="alert" className="text-xs text-destructive">{submitError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            送出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
