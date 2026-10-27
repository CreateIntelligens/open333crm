/**
 * 優惠券後台的 flow（coupon.routes.ts）。route 呼叫這裡，不自己開交易（AGENTS.md 結構規則 2）。
 * 只呼叫一個 service 函式的操作用 flowOf；批次發券要分批開交易，寫成一般的 flow 函式。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import {
  checkSharedCode,
  createCoupon,
  deleteCoupon,
  duplicateCoupon,
  getCoupon,
  listCoupons,
  updateCoupon,
} from './coupon.service.js';
import { changeStatus } from './coupon-lifecycle.service.js';
import { ISSUE_BATCH_SIZE, issueCoupons, type IssueResult } from './coupon-issue.service.js';
import { importCodes, previewImport, removeAvailableCode } from './coupon-import.service.js';
import { previewBroadcastAudience } from '../marketing/marketing.service.js';
import { listCouponBroadcasts } from '../marketing/broadcast-coupon.service.js';

export const listCouponsFlow = flowOf(listCoupons);
export const getCouponFlow = flowOf(getCoupon);
export const createCouponFlow = flowOf(createCoupon);
export const updateCouponFlow = flowOf(updateCoupon);
export const duplicateCouponFlow = flowOf(duplicateCoupon);
export const checkSharedCodeFlow = flowOf(checkSharedCode);
export const deleteCouponFlow = flowOf(deleteCoupon);
/** 在同一個交易內鎖券、改狀態、作廢未使用的券 */
export const changeStatusFlow = flowOf(changeStatus);
export const listCouponBroadcastsFlow = flowOf(listCouponBroadcasts);
export const previewImportFlow = flowOf(previewImport);
export const importCodesFlow = flowOf(importCodes);
export const removeAvailableCodeFlow = flowOf(removeAvailableCode);

/** 券詳情頁「發送給…」送出前預覽：可送達人數、剩餘名額與已達每人上限的人數 */
export function previewBatchAudienceFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
  input: Parameters<typeof previewBroadcastAudience>[2],
) {
  return inTenant(deps.prisma, tenantId, (scope) => previewBroadcastAudience(scope.tx, scope.tenantId, input));
}

/**
 * 批次發券。每 ISSUE_BATCH_SIZE 人一個交易（交易時限 5 秒）；已提交的批次不會因後面的批次失敗而回滾。
 * 第一批就失敗時丟出錯誤；之後的批次失敗時回傳已發出的結果，並以 stopped 帶回錯誤與沒有處理的對象。
 */
export async function issueCouponsInBatchesFlow(
  deps: { prisma: PrismaClient },
  tenantId: string,
  couponId: string,
  input: { contactIds: string[]; issuedVia: string; issuedRefId: string },
): Promise<IssueResult & { stopped?: { error: unknown; notAttempted: string[] } }> {
  const merged: IssueResult = { issued: [], skipped: [] };
  for (let start = 0; start < input.contactIds.length; start += ISSUE_BATCH_SIZE) {
    const batch = input.contactIds.slice(start, start + ISSUE_BATCH_SIZE);
    try {
      const result = await inTenant(deps.prisma, tenantId, (scope) =>
        issueCoupons(scope, couponId, { contactIds: batch, issuedVia: input.issuedVia, issuedRefId: input.issuedRefId }));
      merged.issued.push(...result.issued);
      merged.skipped.push(...result.skipped);
    } catch (error) {
      if (start === 0) throw error;
      return { ...merged, stopped: { error, notAttempted: input.contactIds.slice(start) } };
    }
  }
  return merged;
}
