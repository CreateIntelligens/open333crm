'use client';

/**
 * 公開領券連結（add-coupon-system design D30）的資料存取。
 * API 見 apps/api/src/modules/coupon/coupon-claim-link.routes.ts。
 */
import useSWR from 'swr';
import api from '@/lib/api';

export type ClaimLinkStatus = 'ACTIVE' | 'DISABLED';

export interface CouponClaimLink {
  id: string;
  couponId: string;
  name: string;
  code: string;
  status: ClaimLinkStatus;
  startAt: string | null;
  endAt: string | null;
  openCount: number;
  claimCount: number;
  createdAt: string;
  /** 公開領券頁網址 */
  url: string;
  channel: {
    id: string;
    channelType: string;
    displayName: string;
    /** 渠道沒有公開帳號 ID 或已停用時為 false：顧客開不了對話 */
    ready: boolean;
  };
}

export interface ClaimLinkInput {
  name: string;
  channelId: string;
  startAt?: string | null;
  endAt?: string | null;
}

const fetcher = async (url: string) => (await api.get(url)).data.data as CouponClaimLink[];

export function useCouponClaimLinks(couponId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(couponId ? `/coupons/${couponId}/claim-links` : null, fetcher);
  return { links: data ?? [], error, isLoading, mutate };
}

/** 建立領券連結；回傳的 qrCode 為 PNG data URI */
export async function createClaimLink(couponId: string, input: ClaimLinkInput): Promise<CouponClaimLink & { qrCode: string }> {
  return (await api.post(`/coupons/${couponId}/claim-links`, input)).data.data;
}

export async function setClaimLinkStatus(couponId: string, linkId: string, status: ClaimLinkStatus): Promise<CouponClaimLink> {
  const action = status === 'ACTIVE' ? 'enable' : 'disable';
  return (await api.post(`/coupons/${couponId}/claim-links/${linkId}/${action}`)).data.data;
}

/** 下載 QR Code（PNG） */
export async function downloadClaimLinkQr(couponId: string, linkId: string): Promise<Blob> {
  return (await api.get(`/coupons/${couponId}/claim-links/${linkId}/qrcode`, { responseType: 'blob' })).data as Blob;
}

/** 租戶內可放進訊息的領券連結（啟用、券進行中、沒有結束），附券名 */
export interface AvailableClaimLink extends CouponClaimLink {
  couponName: string;
}

const availableFetcher = async (url: string) => (await api.get(url)).data.data as AvailableClaimLink[];

/**
 * 素材編輯器「插入領券連結」用的清單（change improve-coupon-url-insert-ux design D6）。
 * enabled 為 false 時不發請求：只有打開清單時才載入。
 */
export function useAvailableClaimLinks(enabled: boolean) {
  const { data, error, isLoading } = useSWR(enabled ? '/coupons/claim-links' : null, availableFetcher);
  return { links: data, error, isLoading };
}
