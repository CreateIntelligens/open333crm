/**
 * 券現在能不能發（選券清單用）。與後端 @open333crm/core 的 isCouponPastFixedEnd 同一條規則：
 * 固定效期的券到期後狀態仍是進行中（系統沒有排程自動結束），只看狀態會選到發不出去的券。
 */
type Validity = { validityMode?: string | null; endAt?: string | null };

/** 固定效期的券已過到期日（到期當下起算） */
export function isCouponPastFixedEnd(coupon: Validity, now: number = Date.now()): boolean {
  return coupon.validityMode === 'FIXED' && Boolean(coupon.endAt) && Date.parse(coupon.endAt!) <= now;
}

export function isCouponIssuable(coupon: Validity & { status: string }, now: number = Date.now()): boolean {
  return coupon.status === 'ACTIVE' && !isCouponPastFixedEnd(coupon, now);
}
