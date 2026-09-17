/**
 * 發券：配額檢查 → 券碼配發 → 建立 CouponInstance。
 *
 * ⚠️ 全程在交易內，因為配額檢查與建立之間若被插隊，總量會超發。
 * TenantDb 不含 $transaction，故此處收 PrismaClient 走 withTenant（見 lib/tenant-db.ts 註解）。
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { withTenant } from '../../lib/tenant-db.js';
import { generateCouponCode } from './coupon-code.service.js';
import { CouponValidationError } from './coupon.service.js';

/** 領取憑證預設有效 72 小時（design D10：短效、一次性）。 */
const DEFAULT_CLAIM_TOKEN_HOURS = 72;

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
}

export interface IssuedInstance {
  id: string;
  contactId: string | null;
  code: string;
  status: string;
  claimToken: string | null;
}

export interface IssueResult {
  issued: IssuedInstance[];
  /** 未發出者與原因，讓呼叫端能逐筆回報而非只說失敗 */
  skipped: Array<{ contactId: string; reason: string }>;
}

function claimToken(): string {
  // 32 bytes CSPRNG → base64url；憑證即所有權，不可用可預測來源
  return randomBytes(32).toString('base64url');
}

/**
 * 依 codeMode 取得一組券碼。IMPORTED_CODES 需從庫存搶一筆，
 * 用條件式更新避免兩張券拿到同一個序號。
 */
async function allocateCode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  coupon: { id: string; codeMode: string; sharedCode: string | null; codePrefix: string | null },
): Promise<string> {
  if (coupon.codeMode === 'SHARED_CODE') {
    if (!coupon.sharedCode) throw new CouponValidationError('此券未設定共用券碼');
    return coupon.sharedCode;
  }

  if (coupon.codeMode === 'IMPORTED_CODES') {
    const candidate = await tx.couponCode.findFirst({
      where: { couponId: coupon.id, tenantId, status: 'AVAILABLE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) throw new CouponValidationError('序號已用罄');
    // 搶佔：只有把 AVAILABLE 改成 ASSIGNED 成功的人才真的拿到這個號
    const taken = await tx.couponCode.updateMany({
      where: { id: candidate.id, tenantId, status: 'AVAILABLE' },
      data: { status: 'ASSIGNED' },
    });
    if (taken.count === 0) throw new CouponValidationError('序號配發衝突，請重試');
    return candidate.code;
  }

  // UNIQUE_CODE：產生後查重，極低機率碰撞時重試
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCouponCode(coupon.codePrefix);
    const exists = await tx.couponInstance.findFirst({
      where: { tenantId, code },
      select: { id: true },
    });
    if (!exists) return code;
  }
  throw new CouponValidationError('券碼產生失敗，請重試');
}

/** 依效期模式計算此張券的到期時間；AFTER_OPEN 於開啟時才算，故此處為 null。 */
function computeExpiresAt(
  coupon: { validityMode: string; endAt: Date | null; afterClaimDays: number | null },
  claimed: boolean,
): Date | null {
  if (coupon.validityMode === 'FIXED') return coupon.endAt;
  if (coupon.validityMode === 'AFTER_CLAIM' && claimed && coupon.afterClaimDays) {
    return new Date(Date.now() + coupon.afterClaimDays * 24 * 60 * 60 * 1000);
  }
  return null;
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

  return withTenant(prisma, tenantId, async (tx) => {
    const coupon = await tx.coupon.findFirst({ where: { id: couponId, tenantId } });
    if (!coupon) throw new CouponValidationError('查無此券');
    if (coupon.status !== 'ACTIVE') {
      throw new CouponValidationError('僅能發放進行中的券');
    }

    const issued: IssuedInstance[] = [];
    const skipped: IssueResult['skipped'] = [];

    // 逐筆處理：每位對象的每人上限不同，且部分失敗不應讓整批失敗
    for (const contactId of opts.contactIds) {
      // 總量上限：每發一張都重查，因為同一批內也會累加
      if (coupon.totalLimit != null) {
        const total = await tx.couponInstance.count({ where: { couponId, tenantId } });
        if (total >= coupon.totalLimit) {
          skipped.push({ contactId, reason: 'TOTAL_LIMIT_REACHED' });
          continue;
        }
      }

      const held = await tx.couponInstance.count({
        where: {
          couponId,
          tenantId,
          contactId,
          // 已核銷／已失效者不佔用額度，否則回頭客永遠拿不到第二張
          status: { in: ['ISSUED', 'CLAIMED', 'OPENED'] },
        },
      });
      if (held >= coupon.perContactLimit) {
        skipped.push({ contactId, reason: 'PER_CONTACT_LIMIT_REACHED' });
        continue;
      }

      const requireClaim = opts.requireClaim ?? false;
      const status = requireClaim ? 'ISSUED' : 'CLAIMED';
      const now = new Date();

      try {
        const code = await allocateCode(tx, tenantId, coupon);
        const instance = await tx.couponInstance.create({
          data: {
            tenantId,
            couponId,
            contactId,
            code,
            status,
            claimToken: requireClaim ? claimToken() : null,
            claimTokenExpiresAt: requireClaim
              ? new Date(Date.now() + (opts.claimTokenHours ?? DEFAULT_CLAIM_TOKEN_HOURS) * 60 * 60 * 1000)
              : null,
            claimedAt: requireClaim ? null : now,
            expiresAt: computeExpiresAt(coupon, !requireClaim),
            issuedVia: opts.issuedVia ?? null,
            issuedRefId: opts.issuedRefId ?? null,
          },
        });
        issued.push({
          id: instance.id,
          contactId: instance.contactId,
          code: instance.code,
          status: instance.status,
          claimToken: instance.claimToken,
        });
      } catch (err) {
        if (err instanceof CouponValidationError) {
          // 序號用罄等情形：記錄後繼續處理其他對象，不讓整批中斷
          skipped.push({ contactId, reason: err.message });
          continue;
        }
        throw err;
      }
    }

    return { issued, skipped };
  });
}
