'use client';

/**
 * 顧客票券夾的資料存取。API 見 apps/api/src/modules/coupon/coupon-fan.routes.ts。
 */
import useSWR from 'swr';
import fanApi from '@/lib/fan-api';

export type WalletStatus = 'AVAILABLE' | 'EXPIRING' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'ENDED';
export type WalletTab = 'available' | 'used' | 'invalid';

export interface FanCoupon {
  id: string;
  /** 未到生效日且商家開啟遮蔽時為 null */
  code: string | null;
  codeHidden: boolean;
  availableAt: string | null;
  status: string;
  walletStatus: WalletStatus;
  walletTab: WalletTab;
  daysLeft: number | null;
  expiresAt: string | null;
  claimedAt: string | null;
  openedAt: string | null;
  redeemedAt: string | null;
  coupon: {
    name: string;
    description: string | null;
    /** 已消毒的 HTML */
    terms: string | null;
    imageUrl: string | null;
    couponType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE' | null;
    discountAmount: number | null;
    /** 折掉的百分比：15 代表打 85 折 */
    discountPercent: number | null;
    minSpend: number | null;
    percentCap: number | null;
    giftName: string | null;
    giftQty: number | null;
    exchangeItem: string | null;
    exchangeValueCap: number | null;
    validityMode: 'FIXED' | 'AFTER_CLAIM' | 'AFTER_OPEN' | null;
    startAt: string | null;
    endAt: string | null;
    redeemMode: 'STAFF_CODE' | 'STAFF_SCAN' | 'SELF' | null;
    afterOpenMinutes: number | null;
    staffCodeLength: number | null;
  };
}

export type WalletSession =
  | { status: 'ok'; fanToken: string; tenantId: string; contactId: string; instanceId: string }
  | { status: 'verification_required'; kind: 'phone' | 'email'; registrationUrl: string }
  | { status: 'unavailable' }
  | { status: 'rate_limited' };

const fetcher = (url: string) => fanApi.get(url).then((r) => r.data);

/** 票券連結換顧客憑證。連結過期時 API 回 410（axios 會丟錯）。 */
export async function openWalletSession(token: string): Promise<WalletSession> {
  return (await fanApi.post('/fan/coupons/session', { token })).data.data;
}

export function useWallet(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<{
    data: FanCoupon[];
    meta: { counts: Record<WalletTab, number> };
  }>(enabled ? '/fan/coupons' : null, fetcher);
  return {
    coupons: data?.data ?? [],
    counts: data?.meta.counts ?? { available: 0, used: 0, invalid: 0 },
    error,
    isLoading,
    mutate,
  };
}

/** 單張券。refreshMs 用於店員掃碼券：出示 QR 時輪詢，店員核銷後切到完成頁。 */
export function useFanCoupon(id: string | null, refreshMs = 0) {
  const { data, error, isLoading, mutate } = useSWR<{ data: FanCoupon }>(
    id ? `/fan/coupons/${id}` : null,
    fetcher,
    refreshMs > 0 ? { refreshInterval: refreshMs } : undefined,
  );
  return { coupon: data?.data ?? null, error, isLoading, mutate };
}

export async function getCouponQrCode(id: string): Promise<string> {
  return (await fanApi.get(`/fan/coupons/${id}/qrcode`)).data.data.dataUrl;
}

/** 開始使用店員驗證碼券：回傳核銷時段結束時間 */
export async function startStaffCodeSession(id: string): Promise<{ expiresAt: string }> {
  return (await fanApi.post(`/fan/coupons/${id}/start`, {})).data.data;
}

/** 店員輸入驗證碼核銷。錯誤時後端回 409，details.attemptsLeft 為剩餘次數 */
export async function redeemWithStaffCode(id: string, code: string): Promise<{ redeemedAt: string }> {
  return (await fanApi.post(`/fan/coupons/${id}/redeem-code`, { code })).data.data;
}

/** 顧客自助核銷（滑動確認） */
export async function redeemSelf(id: string): Promise<{ redeemedAt: string }> {
  return (await fanApi.post(`/fan/coupons/${id}/redeem`, {})).data.data;
}

/** 開啟後計時的券：按下使用時才開始計時 */
export async function openCoupon(id: string): Promise<{ expiresAt: string | null }> {
  return (await fanApi.post(`/fan/coupons/${id}/open`, {})).data.data;
}
