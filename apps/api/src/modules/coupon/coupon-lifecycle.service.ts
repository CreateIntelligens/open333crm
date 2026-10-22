/**
 * 券的狀態流轉（發布／暫停／恢復／結束）與發布前驗證。
 *
 * 狀態機：DRAFT → ACTIVE ⇄ PAUSED → ENDED。ENDED 為終態不可逆——
 * 已結束的券若能復活，顧客手上過期的券會突然又能用。
 */
import type { Prisma } from '@prisma/client';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { CouponValidationError } from './coupon.service.js';

type CouponStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

const ALLOWED: Record<CouponStatus, CouponStatus[]> = {
  DRAFT: ['ACTIVE', 'ENDED'],
  ACTIVE: ['PAUSED', 'ENDED'],
  PAUSED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

/** 錯誤訊息用的中文狀態名稱（不讓 ACTIVE、ENDED 等代碼出現在畫面上） */
const STATUS_LABEL: Record<CouponStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '進行中',
  PAUSED: '已暫停',
  ENDED: '已結束',
};

/**
 * 發布前檢查：設定不完整的券一旦發出去，顧客會拿到不能用的券。
 * 這些檢查刻意只在發布時做，讓草稿階段可以慢慢填。
 */
export async function validateForPublish(ctx: TenantCtx, couponId: string): Promise<void> {
  const db = ctx.tx;
  const { tenantId } = ctx;
  const coupon = await db.coupon.findFirst({ where: { id: couponId, tenantId } });
  if (!coupon) throw new CouponValidationError('查無此券');

  // 草稿可以只有券名；這五項決定券怎麼算、怎麼發、怎麼核銷，發布時一定要有
  const required: [unknown, string][] = [
    [coupon.couponType, '請選擇券型'],
    [coupon.purpose, '請選擇用途'],
    [coupon.validityMode, '請選擇效期模式'],
    [coupon.codeMode, '請選擇序號模式'],
    [coupon.redeemMode, '請選擇核銷方式'],
  ];
  for (const [value, message] of required) {
    if (!value) throw new CouponValidationError(message);
  }

  if (coupon.couponType === 'GIFT' && !coupon.giftName) {
    throw new CouponValidationError('贈品券須填寫贈品名稱');
  }
  if (coupon.couponType === 'EXCHANGE' && !coupon.exchangeItem) {
    throw new CouponValidationError('兌換券須填寫兌換品項');
  }
  if (coupon.couponType === 'DISCOUNT_AMOUNT' && !coupon.discountAmount) {
    throw new CouponValidationError('折抵金額券須填寫折抵金額');
  }
  if (coupon.couponType === 'DISCOUNT_PERCENT' && !coupon.discountPercent) {
    throw new CouponValidationError('折抵比例券須填寫折抵百分比');
  }

  if (coupon.validityMode === 'FIXED') {
    if (!coupon.startAt || !coupon.endAt) {
      throw new CouponValidationError('固定效期須填寫生效日與到期日');
    }
    if (coupon.endAt <= new Date()) {
      throw new CouponValidationError('到期日已過，無法發布');
    }
  }
  if (coupon.validityMode === 'AFTER_CLAIM' && !coupon.afterClaimDays) {
    throw new CouponValidationError('領取後計時須填寫有效天數');
  }
  if (coupon.validityMode === 'AFTER_OPEN' && !coupon.afterOpenMinutes) {
    throw new CouponValidationError('開啟後計時須填寫有效分鐘數');
  }

  if (coupon.codeMode === 'SHARED_CODE' && !coupon.sharedCode) {
    throw new CouponValidationError('共用券碼模式須填寫券碼');
  }
  if (coupon.codeMode === 'IMPORTED_CODES') {
    const available = await db.couponCode.count({
      where: { couponId, tenantId, status: 'AVAILABLE' },
    });
    if (available === 0) {
      throw new CouponValidationError('序號包模式須先匯入可用序號');
    }
  }

  // 店員驗證碼模式必須有碼，否則核銷時店員無碼可輸、券等同無法核銷
  if (coupon.redeemMode === 'STAFF_CODE' && !coupon.staffCode) {
    throw new CouponValidationError('店員驗證碼模式須設定驗證碼');
  }
}

export type ChangeStatusResult =
  | { ok: true; claimed?: number; unredeemed?: number }
  | { ok: false; reason: string };

export async function changeStatus(
  ctx: TenantCtx,
  couponId: string,
  next: CouponStatus,
): Promise<ChangeStatusResult> {
  const db = ctx.tx;
  const { tenantId } = ctx;
  // 與發券同一把鎖（core issueInstances）：結束時等進行中的發券提交後才作廢，不會漏掉剛發出的券。
  // ctx.tx 是入口開的交易，鎖會維持到交易結束
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${couponId}, 0))`;
  const coupon = await db.coupon.findFirst({ where: { id: couponId, tenantId } });
  if (!coupon) return { ok: false, reason: 'NOT_FOUND' };

  const current = coupon.status as CouponStatus;
  if (!ALLOWED[current].includes(next)) {
    return {
      ok: false,
      reason: current === next
        ? `此券已是「${STATUS_LABEL[current]}」`
        : `「${STATUS_LABEL[current]}」的券無法改為「${STATUS_LABEL[next]}」`,
    };
  }
  if (next === 'ACTIVE') {
    await validateForPublish(ctx, couponId);
  }

  // 條件式更新：確認狀態仍是讀到的那個，避免併發下兩個請求各自轉到不同狀態
  const result = await db.coupon.updateMany({
    where: { id: couponId, tenantId, status: current },
    data: { status: next },
  });
  if (result.count === 0) return { ok: false, reason: 'CONFLICT' };

  if (next === 'ENDED') return { ok: true, ...(await revokeUnredeemed(db, tenantId, couponId)) };
  return { ok: true };
}

/**
 * 提前結束：已發出但尚未核銷的券一律作廢，顧客不能再用。已核銷的維持原狀。
 * 回傳結束前的已領取張數與其中未使用張數，供後台提示影響範圍。
 */
async function revokeUnredeemed(db: Prisma.TransactionClient, tenantId: string, couponId: string) {
  const where = { tenantId, couponId };
  const [claimed, unredeemed] = await Promise.all([
    db.couponInstance.count({ where: { ...where, claimedAt: { not: null } } }),
    db.couponInstance.count({ where: { ...where, status: { in: ['CLAIMED', 'OPENED'] } } }),
  ]);
  await db.couponInstance.updateMany({
    where: { ...where, status: { in: ['ISSUED', 'CLAIMED', 'OPENED'] } },
    data: { status: 'REVOKED' },
  });
  return { claimed, unredeemed };
}
