/**
 * 發券：配額檢查 → 券碼配發 → 建立 CouponInstance。
 *
 * 核心邏輯在 `@open333crm/core` 的 issueInstances——關鍵字觸發的發券在 workers
 * 執行且不能相依 apps/api，兩端必須共用同一套配額規則，否則總量上限會不一致。
 * 本檔負責 apps/api 這側的租戶注入（withTenant）與錯誤轉換。
 *
 * ⚠️ 全程在交易內：配額檢查與建立之間若被插隊，總量會超發。
 * TenantDb 不含 $transaction，故此處收 PrismaClient（見 lib/tenant-db.ts 註解）。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { couponSourceName, issueInstances, type IssuedInstance, type IssueSkipReason } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { applyClaimTag } from './coupon-tagging.js';
import { CouponValidationError } from './coupon.service.js';

export type { IssuedInstance };

export interface IssueOptions {
  /** 發放對象。FB／IG 對象亦可，領取時會改綁為完成驗證的聯絡人 */
  contactIds: string[];
  /** 發放來源，供成效歸因（inbox／keyword／broadcast／public…） */
  issuedVia?: string;
  issuedRefId?: string;
  /**
   * 是否需要顧客領取。LINE 已知身分者傳 false（直接 CLAIMED）；
   * FB／IG 與公開領券傳 true（ISSUED + claimToken），見 design D10。
   */
  requireClaim?: boolean;
  claimTokenHours?: number;
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

export async function issueCoupons(
  prisma: PrismaClient,
  tenantId: string,
  couponId: string,
  opts: IssueOptions,
): Promise<IssueResult> {
  if (opts.contactIds.length === 0) {
    throw new CouponValidationError('請選擇發放對象');
  }
  return withTenant(prisma, tenantId, (tx) => issueCouponsInTx(tx, tenantId, couponId, opts));
}

/**
 * 在呼叫端的交易內發券（對話發券先在短交易內保留，見 design D16）。
 * tx 必須已綁定租戶（withTenant）。
 */
export async function issueCouponsInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  couponId: string,
  opts: IssueOptions,
): Promise<IssueResult> {
  if (opts.contactIds.length === 0) {
    throw new CouponValidationError('請選擇發放對象');
  }
  const coupon = await tx.coupon.findFirst({ where: { id: couponId, tenantId } });
  if (!coupon) throw new CouponValidationError('查無此券');
  if (coupon.status !== 'ACTIVE') {
    throw new CouponValidationError('僅能發放進行中的券');
  }

  const requireClaim = opts.requireClaim ?? false;
  const outcome = await issueInstances(tx, {
    tenantId,
    coupon,
    contactIds: opts.contactIds,
    issuedVia: opts.issuedVia,
    issuedRefId: opts.issuedRefId,
    issuedSourceName: opts.sourceName ?? couponSourceName(opts.issuedVia),
    issuedByName: opts.issuedByName,
    requireClaim,
    claimTokenHours: opts.claimTokenHours,
  });

  // 直接歸戶者（LINE）不會經過 claimByToken，貼標要在此補上；
  // 待領取者（FB／IG）於實際領取時才貼，避免沒領的人也被貼標
  if (!requireClaim && coupon.claimTagId && !opts.skipClaimTag) {
    for (const instance of outcome.issued) {
      if (instance.contactId) {
        await applyClaimTag(tx, tenantId, instance.contactId, coupon);
      }
    }
  }

  return outcome;
}
