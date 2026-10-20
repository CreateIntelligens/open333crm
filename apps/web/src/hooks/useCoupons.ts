'use client';

/**
 * 優惠券後台的資料存取。API 見 apps/api/src/modules/coupon/coupon.routes.ts 與 coupon-instance.routes.ts。
 */
import useSWR from 'swr';
import api from '@/lib/api';

export type CouponStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
export type CouponType = 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE';
export type CouponPurpose = 'MARKETING' | 'SERVICE';
export type ValidityMode = 'FIXED' | 'AFTER_CLAIM' | 'AFTER_OPEN';
export type CodeMode = 'UNIQUE_CODE' | 'SHARED_CODE' | 'IMPORTED_CODES';
export type RedeemMode = 'STAFF_CODE' | 'STAFF_SCAN' | 'SELF';
export type InstanceStatus = 'ISSUED' | 'CLAIMED' | 'OPENED' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';

export interface Coupon {
  id: string;
  displayCode: string;
  name: string;
  description: string | null;
  terms: string | null;
  imageUrl: string | null;
  couponType: CouponType | null;
  purpose: CouponPurpose | null;
  discountAmount: number | null;
  discountPercent: number | null;
  minSpend: number | null;
  percentCap: number | null;
  giftName: string | null;
  giftQty: number | null;
  exchangeItem: string | null;
  exchangeValueCap: number | null;
  validityMode: ValidityMode | null;
  startAt: string | null;
  endAt: string | null;
  afterClaimDays: number | null;
  afterOpenMinutes: number | null;
  codeMode: CodeMode | null;
  sharedCode: string | null;
  codePrefix: string | null;
  redeemMode: RedeemMode | null;
  staffCode: string | null;
  totalLimit: number | null;
  perContactLimit: number;
  claimTagId: string | null;
  claimTagTtlDays: number | null;
  maskCodeBeforeStart: boolean;
  status: CouponStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CouponListItem extends Coupon {
  issuedCount: number;
  claimedCount: number;
  redeemedCount: number;
}

export type StatusCounts = Record<'ALL' | CouponStatus, number>;

/** 建立與更新送出的欄位；與 apps/api 的 couponInputSchema 對應。日期送 YYYY-MM-DD。 */
export type CouponInput = Partial<
  Omit<Coupon, 'id' | 'displayCode' | 'status' | 'createdAt' | 'updatedAt'>
>;

export interface CouponStats {
  /** 序號包匯入的序號總數；非序號包模式為 null */
  poolSize: number | null;
  issued: number;
  claimed: number;
  opened: number;
  redeemed: number;
  claimRate: number | null;
  redeemRate: number | null;
}

export interface CouponInstanceRow {
  id: string;
  code: string;
  status: InstanceStatus;
  issuedAt: string;
  claimedAt: string | null;
  openedAt: string | null;
  redeemedAt: string | null;
  issuedVia: string | null;
  issuedSourceName: string | null;
  issuedByName: string | null;
  redeemChannel: string | null;
  contact: { id: string; displayName: string | null } | null;
}

export interface InstanceQuery {
  q?: string;
  status?: InstanceStatus;
  claimedFrom?: string;
  claimedTo?: string;
  redeemedFrom?: string;
  redeemedTo?: string;
  page?: number;
}

interface ListResponse<T, M = Record<string, unknown>> {
  success: boolean;
  data: T;
  meta: { total: number; page: number; limit: number } & M;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export function useCoupons(params: { q?: string; status?: CouponStatus | ''; page?: number } = {}) {
  const key = `/coupons${toQuery({ q: params.q, status: params.status || undefined, page: params.page })}`;
  const { data, error, isLoading, mutate } = useSWR<ListResponse<CouponListItem[], { statusCounts: StatusCounts }>>(
    key,
    fetcher,
  );
  return {
    coupons: data?.data ?? [],
    meta: data?.meta,
    error,
    isLoading,
    mutate,
  };
}

export function useCoupon(id: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: Coupon }>(
    id ? `/coupons/${id}` : null,
    fetcher,
  );
  return { coupon: data?.data ?? null, error, isLoading, mutate };
}

export function useCouponStats(id: string | null | undefined) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: CouponStats }>(
    id ? `/coupons/${id}/stats` : null,
    fetcher,
  );
  return { stats: data?.data ?? null, error, isLoading, mutate };
}

export function useCouponInstances(id: string | null | undefined, query: InstanceQuery) {
  const key = id ? `/coupons/${id}/instances${toQuery({ ...query })}` : null;
  const { data, error, isLoading, mutate } = useSWR<ListResponse<CouponInstanceRow[]>>(key, fetcher);
  return { instances: data?.data ?? [], meta: data?.meta, error, isLoading, mutate };
}

export async function createCoupon(input: CouponInput & { name: string }): Promise<Coupon> {
  return (await api.post('/coupons', input)).data.data;
}

export async function updateCoupon(id: string, input: CouponInput): Promise<Coupon> {
  return (await api.patch(`/coupons/${id}`, input)).data.data;
}

export async function publishCoupon(id: string): Promise<void> {
  await api.post(`/coupons/${id}/publish`);
}

export async function pauseCoupon(id: string): Promise<void> {
  await api.post(`/coupons/${id}/pause`);
}

export async function resumeCoupon(id: string): Promise<void> {
  await api.post(`/coupons/${id}/resume`);
}

/** 提前結束；回傳結束前的已領取與其中未使用張數。 */
export async function endCoupon(id: string): Promise<{ claimed?: number; unredeemed?: number }> {
  return (await api.post(`/coupons/${id}/end`)).data.data ?? {};
}

export async function duplicateCoupon(id: string): Promise<Coupon> {
  return (await api.post(`/coupons/${id}/duplicate`)).data.data;
}

export async function deleteCoupon(id: string): Promise<void> {
  await api.delete(`/coupons/${id}`);
}

export async function checkSharedCode(
  code: string,
  excludeId?: string,
): Promise<{ available: boolean; message?: string }> {
  return (await api.get(`/coupons/shared-code/check${toQuery({ code, excludeId })}`)).data.data;
}

export async function previewCodeImport(id: string, codes: string) {
  return (await api.post(`/coupons/${id}/codes/preview`, { codes })).data.data;
}

export async function importCodes(id: string, codes: string) {
  return (await api.post(`/coupons/${id}/codes`, { codes })).data.data;
}

/** 下載序號明細 CSV（後端產生，含 BOM）。 */
export async function downloadInstancesCsv(id: string): Promise<Blob> {
  return (await api.get(`/coupons/${id}/instances/export`, { responseType: 'blob' })).data;
}
