/**
 * 發券：配額檢查 → 券碼配發 → 建立 CouponInstance。
 *
 * 核心邏輯在 `@open333crm/core` 的 issueInstances——關鍵字觸發的發券在 workers
 * 執行且不能相依 apps/api，兩端必須共用同一套配額規則，否則總量上限會不一致。
 * 本檔負責 apps/api 這側的錯誤轉換與貼標；交易由入口開（TenantCtx）。
 *
 * ⚠️ 全程在交易內：配額檢查與建立之間若被插隊，總量會超發。
 */

import { couponSourceName, issueInstances, type IssuedInstance, type IssueSkipReason } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { applyClaimTag } from './coupon-tagging.js';
import { CouponValidationError } from './coupon.service.js';

export type { IssuedInstance };

/**
 * 入口分批發券時每批的人數：每人約 4～8 個查詢（設了領券標籤時更多），一批要在 5 秒的交易時限內完成，
 * 並為資料庫延遲較高的環境留餘裕
 */
export const ISSUE_BATCH_SIZE = 50;

export interface IssueOptions {
  /** 發放對象。發券一律直接歸戶（design D30），顧客開啟票券連結時才做歸戶驗證 */
  contactIds: string[];
  /** 發放來源，供成效歸因（inbox／keyword／broadcast／public…） */
  issuedVia?: string;
  issuedRefId?: string;
  /** 發放來源名稱快照；未給時依 issuedVia 帶預設名稱（例如 inbox → 對話發券） */
  sourceName?: string;
  /** 發券座席名稱快照（對話發券） */
  issuedByName?: string;
  /** 不在此貼標：對話發券要等訊息送出後才貼（design D16） */
  skipClaimTag?: boolean;
}


export interface IssueResult {
  issued: IssuedInstance[];
  /** 未發出者與原因，讓呼叫端能逐筆回報而非只說失敗 */
  skipped: Array<{ contactId: string; reason: IssueSkipReason }>;
}

/**
 * 在入口開的交易內發券（對話發券先在短交易內保留，見 design D16）。
 * 交易時限 5 秒：大批發券由入口分批，每批一個交易（券的鎖讓每人上限與總量在批次間仍正確）。
 */
export async function issueCoupons(
  ctx: TenantCtx,
  couponId: string,
  opts: IssueOptions,
): Promise<IssueResult> {
  const { tx, tenantId } = ctx;
  if (opts.contactIds.length === 0) {
    throw new CouponValidationError('請選擇發放對象');
  }
  // 先鎖再讀狀態：讀到「進行中」之後才被結束的話，結束會等這次發券提交後再作廢（同一把鎖，可重入）
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${couponId}, 0))`;
  const coupon = await tx.coupon.findFirst({ where: { id: couponId, tenantId } });
  if (!coupon) throw new CouponValidationError('查無此券');
  if (coupon.status !== 'ACTIVE') {
    throw new CouponValidationError('僅能發放進行中的券');
  }

  const outcome = await issueInstances(tx, {
    tenantId,
    coupon,
    contactIds: opts.contactIds,
    issuedVia: opts.issuedVia,
    issuedRefId: opts.issuedRefId,
    issuedSourceName: opts.sourceName ?? couponSourceName(opts.issuedVia),
    issuedByName: opts.issuedByName,
  });

  // 發券即歸戶，貼標在這裡做；對話發券等「送出後才確認」的入口傳 skipClaimTag，確認時才貼
  if (coupon.claimTagId && !opts.skipClaimTag) {
    for (const instance of outcome.issued) {
      if (instance.contactId) {
        await applyClaimTag(tx, tenantId, instance.contactId, coupon);
      }
    }
  }

  return outcome;
}
