'use client';

/**
 * 廣播表單的「附上優惠券」（add-coupon-system design D29）：只能附進行中的行銷券。
 * 每位收件人各得一張券與自己的票券連結；素材放 {{coupon.url}} 就代入連結，沒放就另送一則發券文字。
 * 受眾大於剩餘名額時顯示警示，勾選確認後才能建立。
 */
import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import { getApiErrorMessage } from '@/lib/api-error';
import { Select } from '@/components/ui/select';
import { couponCapacityWarning, type CouponAudiencePreview } from '@/lib/marketing/coupon-broadcast';

interface CouponOption {
  id: string;
  name: string;
  displayCode?: string;
}

export interface BroadcastCouponFieldProps {
  value: string;
  onChange: (couponId: string) => void;
  /** 選了券之後的受眾預覽（含剩餘名額） */
  preview: Pick<CouponAudiencePreview, 'reachable' | 'coupon'> | null;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}

export function BroadcastCouponField({ value, onChange, preview, acknowledged, onAcknowledge }: BroadcastCouponFieldProps) {
  const [coupons, setCoupons] = useState<CouponOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/coupons?status=ACTIVE&purpose=MARKETING&limit=100')
      .then((res) => {
        if (!cancelled) {
          setCoupons(res.data.data || []);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getApiErrorMessage(err, '請稍後再試'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const warning = value ? couponCapacityWarning(preview) : null;

  return (
    <div>
      <label htmlFor="broadcast-coupon" className="mb-1 block text-sm font-medium">附上優惠券（選填）</label>
      <Select
        id="broadcast-coupon"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: '', label: '不附券' },
          ...coupons.map((c) => ({ value: c.id, label: c.displayCode ? `${c.name}（${c.displayCode}）` : c.name })),
        ]}
      />
      {loadError && <p className="mt-1 text-xs text-destructive">優惠券清單載入失敗：{loadError}</p>}
      {value && (
        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
          <p>每位收件人各得一張券與自己的票券連結，會一則一則送出（不使用一次群發）。</p>
          <p>
            素材中放 <code className="rounded bg-muted px-1">{'{{coupon.url}}'}</code> 會代入票券連結；沒放時，素材之後會再送一則發券文字。素材可以不選，只送發券文字。
          </p>
          {preview?.coupon && (
            <p className="text-foreground">
              {preview.coupon.remaining == null ? '這張券沒有發行總量上限' : `剩餘名額 ${preview.coupon.remaining} 張`}
              {preview.coupon.limitReached > 0 && `，${preview.coupon.limitReached} 人已達每人上限（不會收到）`}
            </p>
          )}
          {warning && (
            <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-foreground">
              <p>{warning}</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} />
                我了解名額不足，仍要建立
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
