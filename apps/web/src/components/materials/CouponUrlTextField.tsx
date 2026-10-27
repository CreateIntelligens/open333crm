'use client';

/**
 * 文字素材的訊息內容欄位，附「插入券連結」按鈕（add-material-coupon-url-insert）。
 *
 * 按鈕只插入通用佔位字 {{coupon.url}}，不綁定特定優惠券；附券廣播發送時，
 * 後端（broadcast-coupon.flow.ts）才把它換成每位收件人自己的票券連結。
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { Ticket } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export const COUPON_URL_PLACEHOLDER = '{{coupon.url}}';

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

  const insertCouponUrl = () => {
    const el = textareaRef.current;
    const useSelection = hasFocusedRef.current && el !== null;
    const start = useSelection ? el.selectionStart : value.length;
    const end = useSelection ? el.selectionEnd : value.length;
    const nextLength = value.length - (end - start) + COUPON_URL_PLACEHOLDER.length;
    if (nextLength > maxLength) {
      setOverLimitMessage(
        `加入券連結後會有 ${nextLength} 字，超過 ${maxLength} 字上限，請先刪減 ${nextLength - maxLength} 字再插入。`,
      );
      return;
    }
    setOverLimitMessage(null);
    pendingCaretRef.current = start + COUPON_URL_PLACEHOLDER.length;
    onChange(value.slice(0, start) + COUPON_URL_PLACEHOLDER + value.slice(end));
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
        <div className="space-y-1">
          <Button type="button" variant="outline" size="sm" onClick={insertCouponUrl}>
            <Ticket className="mr-1 h-3.5 w-3.5" />插入券連結
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            發送附券廣播時，會換成每位顧客自己的券連結；實際發哪張券，在建立廣播時選擇。用在關鍵字回覆或一般廣播時不會替換。
          </p>
        </div>
        <div className="shrink-0 text-[11px] text-slate-400">{value.length} / {maxLength}</div>
      </div>
      {overLimitMessage && (
        <p role="alert" className="text-xs text-red-600">{overLimitMessage}</p>
      )}
    </div>
  );
}
