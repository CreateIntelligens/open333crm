'use client';

/**
 * 選擇要發送的優惠券（add-coupon-system design D25）：關鍵字回覆頁、加好友禮頁共用。
 *
 * 只列進行中的券（行銷與客服補償都可以），選項顯示「券名（CP 券號）· 用途」。
 * 已存的券之後被暫停、結束或刪除時，保留原值並標示「已暫停、已結束或找不到的券」，
 * 不默默換成空白——管理員要自己決定換哪一張。
 */
import React from 'react';
import useSWR from 'swr';
import api from '@/lib/api';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import type { Coupon } from '@/hooks/useCoupons';
import { isCouponIssuable } from '@/lib/coupon/issuable';

export type CouponOption = Pick<Coupon, 'id' | 'name' | 'displayCode' | 'purpose' | 'status' | 'validityMode' | 'endAt'>;

const PURPOSE_LABEL: Record<string, string> = { MARKETING: '行銷', SERVICE: '客服補償' };

export const UNAVAILABLE_COUPON_LABEL = '已暫停、已結束或找不到的券';

export function couponOptionLabel(c: CouponOption): string {
  const purpose = c.purpose ? PURPOSE_LABEL[c.purpose] : null;
  return `${c.name}（${c.displayCode}）${purpose ? `· ${purpose}` : ''}`;
}

/** 租戶所有的券（各種狀態）：下拉選單只列進行中的，列表用它顯示已存的券名 */
export function useCouponOptions() {
  const { data, error, isLoading } = useSWR('coupon-options:all', () =>
    fetchAllPages<CouponOption>((url, config) => api.get(url, config), '/coupons'),
  );
  return { coupons: data ?? [], error, isLoading };
}

interface Props {
  id?: string;
  label: string;
  value: string;
  onChange: (couponId: string) => void;
  /** 沒有選券時的選項文字 */
  emptyLabel?: string;
}

export function CouponSelectField({ id = 'coupon-select', label, value, onChange, emptyLabel = '— 不發送優惠券 —' }: Props) {
  const { coupons, error, isLoading } = useCouponOptions();
  // 固定效期已過到期日的券狀態仍是進行中，但規則觸發時不會發券，不列出
  const active = coupons.filter((c) => isCouponIssuable(c));
  const missing = Boolean(value) && !active.some((c) => c.id === value);
  // 清單載入完成後才判斷「找不到」，載入中或載入失敗不要把已存的券標成找不到
  const unavailable = missing && !isLoading && !error;
  const missingLabel = isLoading ? '載入中…' : error ? value : UNAVAILABLE_COUPON_LABEL;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{emptyLabel}</option>
        {missing && <option value={value}>{missingLabel}</option>}
        {active.map((c) => (
          <option key={c.id} value={c.id}>
            {couponOptionLabel(c)}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-xs text-destructive">無法載入優惠券清單（可能沒有檢視優惠券的權限），請重新整理或洽管理員。</p>
      )}
      {unavailable && (
        <p className="mt-1 text-xs text-warning">這張券已暫停、已結束、已過到期日或被刪除，規則觸發時不會發券；請換一張進行中的券。</p>
      )}
    </div>
  );
}
