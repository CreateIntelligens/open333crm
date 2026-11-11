'use client';

/**
 * 券詳情頁「發送給…」（add-coupon-system design D31）：預覽、送出與這張券的發放紀錄。
 * 送出後後端馬上在背景發送，發放紀錄自動更新進度與結果。
 */
import useSWR from 'swr';
import api from '@/lib/api';
import type { CouponAudiencePreview, CouponBroadcastSummary } from '@/lib/marketing/coupon-broadcast';

export interface BatchIssueAudience {
  channelId: string;
  targetType: 'contacts' | 'tags' | 'segment';
  contactIds?: string[];
  tagIds?: string[];
  segmentId?: string;
}

export interface CouponBatchRecord {
  id: string;
  name: string;
  status: string;
  couponIssuedVia: string | null;
  couponIssuedByName: string | null;
  totalCount: number;
  couponIssuedCount: number;
  failureReason: string | null;
  failureCode: string | null;
  createdAt: string;
  summary: CouponBroadcastSummary;
}

export async function previewCouponBatchIssue(couponId: string, audience: BatchIssueAudience): Promise<CouponAudiencePreview> {
  const res = await api.post(`/coupons/${couponId}/batch-issue/preview`, audience);
  return res.data.data;
}

export async function createCouponBatchIssue(
  couponId: string,
  body: BatchIssueAudience & { message?: string },
): Promise<{ broadcastId: string; name: string; status: string }> {
  const res = await api.post(`/coupons/${couponId}/batch-issue`, body);
  return res.data.data;
}

/** 有發送中或排程中的紀錄時每 5 秒重新載入，結果出來就停 */
export function useCouponBatchIssues(couponId: string | null) {
  const { data, error, isLoading, mutate } = useSWR(
    couponId ? `/coupons/${couponId}/batch-issues` : null,
    async (url: string) => (await api.get(url)).data.data as CouponBatchRecord[],
    {
      refreshInterval: (latest) =>
        latest?.some((r) => r.status === 'scheduled' || r.status === 'sending') ? 5000 : 0,
    },
  );
  return { records: data ?? [], error, isLoading, mutate };
}
