'use client';

/**
 * 文字素材的訊息內容欄位，附兩種券連結的插入按鈕（add-material-coupon-url-insert；
 * 名稱、說明與「插入領券連結」見 change improve-coupon-url-insert-ux）。
 *
 * - 「插入顧客專屬券連結」：插入通用佔位字 {{coupon.url}}，不綁定特定優惠券；附券廣播發送時，
 *   後端（broadcast-coupon.flow.ts）才發券並把它換成每位收件人自己的票券連結。
 * - 「插入領券連結」：插入券詳情建立的公開領券網址（人人共用，顧客點開後傳訊息才發券）。
 */

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Link2, Ticket } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAvailableClaimLinks, type AvailableClaimLink } from '@/hooks/useCouponClaimLinks';
import { getApiErrorMessage } from '@/lib/api-error';
import { COUPON_URL_PLACEHOLDER } from '@/lib/marketing/coupon-url';

export { COUPON_URL_PLACEHOLDER };

const CHANNEL_LABEL: Record<string, string> = { LINE: 'LINE', FB: 'Facebook', THREADS: 'Instagram' };

interface Props {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  placeholder?: string;
  rows?: number;
}

export function CouponUrlTextField({ value, onChange, maxLength, placeholder, rows = 5 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 點按鈕時輸入框已失焦，但 selectionStart 仍在；只有曾經進過輸入框才採用它，
  // 否則瀏覽器預設的游標（可能在開頭）不代表使用者想插入的位置，改加在結尾。
  const hasFocusedRef = useRef(false);
  const pendingCaretRef = useRef<number | null>(null);
  const [overLimitMessage, setOverLimitMessage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const helpId = useId();
  const pickerId = useId();

  // 插入後在下一次繪製前把焦點與游標移回輸入框（此時 value 已是新內容）
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const el = textareaRef.current;
    if (caret === null || !el) return;
    pendingCaretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [value]);

  const handleTextChange = (next: string) => {
    setOverLimitMessage(null);
    onChange(next);
  };

  /** 把 text 插在游標位置（有選取時取代）；超過字數上限時不改內容並回傳 false */
  const insertText = (text: string, label: string): boolean => {
    const el = textareaRef.current;
    const useSelection = hasFocusedRef.current && el !== null;
    const start = useSelection ? el.selectionStart : value.length;
    const end = useSelection ? el.selectionEnd : value.length;
    const nextLength = value.length - (end - start) + text.length;
    if (nextLength > maxLength) {
      setOverLimitMessage(
        `加入${label}後會有 ${nextLength} 字，超過 ${maxLength} 字上限，請先刪減 ${nextLength - maxLength} 字再插入。`,
      );
      return false;
    }
    setOverLimitMessage(null);
    pendingCaretRef.current = start + text.length;
    onChange(value.slice(0, start) + text + value.slice(end));
    return true;
  };

  const insertClaimLink = (link: AvailableClaimLink) => {
    // 超過上限時清單保持開啟，使用者刪字後可以直接再選
    if (insertText(link.url, '領券連結')) setPickerOpen(false);
  };

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={() => { hasFocusedRef.current = true; }}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => insertText(COUPON_URL_PLACEHOLDER, '顧客專屬券連結')}>
              <Ticket className="mr-1 h-3.5 w-3.5" />插入顧客專屬券連結
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={pickerOpen}
              aria-controls={pickerId}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <Link2 className="mr-1 h-3.5 w-3.5" />插入領券連結
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span>只能用在附券廣播。</span>{' '}
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => setHelpOpen((open) => !open)}
            >
              怎麼用？
            </button>
          </p>
          {helpOpen && (
            <ul id={helpId} className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
              <li>發送附券廣播時，系統會發券給每位收件人，並把這裡換成他自己的券連結。要發哪張券，在建立廣播時選。</li>
              <li>
                用在關鍵字回覆或沒附券的廣播時不會發券，顧客拿不到券：廣播會直接顯示 {COUPON_URL_PLACEHOLDER} 這串字，關鍵字回覆會把它拿掉。系統會在存檔或建立時擋下。
              </li>
              <li>想做一條大家都能點的領券網址，請用「插入領券連結」。</li>
            </ul>
          )}
        </div>
        <div className="shrink-0 text-[11px] text-slate-400">{value.length} / {maxLength}</div>
      </div>
      {pickerOpen && (
        <ClaimLinkPicker id={pickerId} onPick={insertClaimLink} onClose={() => setPickerOpen(false)} />
      )}
      {overLimitMessage && (
        <p role="alert" className="text-xs text-red-600">{overLimitMessage}</p>
      )}
    </div>
  );
}

/** 「插入領券連結」的清單：打開時才載入租戶內可用的領券連結 */
function ClaimLinkPicker({ id, onPick, onClose }: { id: string; onPick: (link: AvailableClaimLink) => void; onClose: () => void }) {
  const { links, error, isLoading } = useAvailableClaimLinks(true);
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  const errorMessage = error
    ? status === 403
      ? '你沒有檢視優惠券的權限，無法列出領券連結。請洽管理員開通「檢視優惠券」。'
      : getApiErrorMessage(error, '無法載入領券連結，請稍後重試')
    : null;

  return (
    <div
      id={id}
      role="group"
      aria-label="選擇要插入的領券連結"
      className="space-y-2 rounded-md border border-border bg-muted p-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">選擇要插入的領券連結</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          關閉
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        領券連結人人共用：顧客點開後傳送領券訊息，系統才發券。適合一般廣播與關鍵字回覆。
      </p>
      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive">{errorMessage}</p>
      ) : isLoading || !links ? (
        <p className="text-xs text-muted-foreground">載入中…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          還沒有可用的領券連結（連結要啟用中、券要進行中）。請到
          <a href="/dashboard/marketing/coupons" className="mx-1 font-medium text-primary underline underline-offset-2">優惠券</a>
          頁打開一張券，在「領券連結」分頁建立。
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {links.map((link) => (
            <li key={link.id}>
              <button
                type="button"
                onClick={() => onPick(link)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-left hover:border-primary-border hover:bg-primary-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block text-sm font-medium text-foreground">{link.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {`券：${link.couponName} · 渠道：${link.channel.displayName}（${CHANNEL_LABEL[link.channel.channelType] ?? link.channel.channelType}）`}
                </span>
                {!link.channel.ready && (
                  <span className="block text-[11px] text-warning">這個渠道還沒設定好，顧客開不了對話，請先到渠道設定補齊</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
