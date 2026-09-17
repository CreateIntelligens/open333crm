/**
 * 優惠券 service —— 券主檔的 CRUD 與發布驗證。
 *
 * 租戶隔離：所有函式收 TenantDb（已綁租戶的連線），並仍帶 where tenantId ——
 * 應用層與 RLS 兩層都要顧，不可因為有 RLS 就省略 where（見 check-tenant-scoping.mjs）。
 */
import type { Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { sanitizeTerms } from './terms-sanitizer.js';
import { normalizePrefix } from './coupon-code.service.js';

export interface CouponInput {
  name?: string;
  description?: string | null;
  terms?: string | null;
  imageUrl?: string | null;
  couponType?: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE';
  purpose?: 'MARKETING' | 'SERVICE';
  discountAmount?: number | null;
  discountPercent?: number | null;
  validityMode?: 'FIXED' | 'AFTER_CLAIM' | 'AFTER_OPEN';
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  afterClaimDays?: number | null;
  afterOpenMinutes?: number | null;
  codeMode?: 'SHARED_CODE' | 'UNIQUE_CODE' | 'IMPORTED_CODES';
  sharedCode?: string | null;
  codePrefix?: string | null;
  redeemMode?: 'STAFF_CODE' | 'STAFF_SCAN' | 'SELF';
  staffCode?: string | null;
  totalLimit?: number | null;
  perContactLimit?: number;
  claimTagId?: string | null;
}

/** 欄位驗證失敗時拋此錯，route 層轉 400；與其他錯誤（500）區分開。 */
export class CouponValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponValidationError';
  }
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new CouponValidationError('日期格式不正確');
  return d;
}

/**
 * 驗證欄位間的相依關係。券型決定要哪個折抵欄位、效期模式決定要哪組時間欄位——
 * 這些在 DB 層無法用約束表達（會隨模式變動），只能在此集中驗。
 */
function validateCouponShape(input: CouponInput, existing?: { couponType?: string; validityMode?: string; codeMode?: string }): void {
  const couponType = input.couponType ?? existing?.couponType;
  const validityMode = input.validityMode ?? existing?.validityMode;

  if (couponType === 'DISCOUNT_AMOUNT') {
    const amt = input.discountAmount;
    if (amt != null && (!Number.isInteger(amt) || amt <= 0)) {
      throw new CouponValidationError('折抵金額須為正整數');
    }
  }
  if (couponType === 'DISCOUNT_PERCENT') {
    const pct = input.discountPercent;
    if (pct != null && (!Number.isInteger(pct) || pct <= 0 || pct >= 100)) {
      throw new CouponValidationError('折抵百分比須介於 1 到 99');
    }
  }

  if (validityMode === 'FIXED') {
    const s = toDate(input.startAt);
    const e = toDate(input.endAt);
    if (s && e && s >= e) throw new CouponValidationError('生效日須早於到期日');
  }
  if (input.afterClaimDays != null && (!Number.isInteger(input.afterClaimDays) || input.afterClaimDays <= 0)) {
    throw new CouponValidationError('領取後有效天數須為正整數');
  }
  if (input.afterOpenMinutes != null && (!Number.isInteger(input.afterOpenMinutes) || input.afterOpenMinutes <= 0)) {
    throw new CouponValidationError('開啟後有效分鐘數須為正整數');
  }

  if (input.perContactLimit != null && (!Number.isInteger(input.perContactLimit) || input.perContactLimit <= 0)) {
    throw new CouponValidationError('每人可領取數量須為正整數');
  }
  if (input.totalLimit != null && (!Number.isInteger(input.totalLimit) || input.totalLimit <= 0)) {
    throw new CouponValidationError('發行總量須為正整數');
  }
}

/** 把 input 轉成 Prisma 欄位；只處理有給的欄位，未給者不動（支援部分更新）。 */
function buildData(input: CouponInput): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name?.trim();
    if (!name) throw new CouponValidationError('券名稱不可為空');
    d.name = name;
  }
  if (input.description !== undefined) d.description = input.description?.trim() || null;
  // 條款一律消毒後才入庫，避免髒資料落地（design D9）
  if (input.terms !== undefined) d.terms = sanitizeTerms(input.terms);
  if (input.imageUrl !== undefined) d.imageUrl = input.imageUrl?.trim() || null;
  if (input.couponType !== undefined) d.couponType = input.couponType;
  if (input.purpose !== undefined) d.purpose = input.purpose;
  if (input.discountAmount !== undefined) d.discountAmount = input.discountAmount;
  if (input.discountPercent !== undefined) d.discountPercent = input.discountPercent;
  if (input.validityMode !== undefined) d.validityMode = input.validityMode;
  if (input.startAt !== undefined) d.startAt = toDate(input.startAt);
  if (input.endAt !== undefined) d.endAt = toDate(input.endAt);
  if (input.afterClaimDays !== undefined) d.afterClaimDays = input.afterClaimDays;
  if (input.afterOpenMinutes !== undefined) d.afterOpenMinutes = input.afterOpenMinutes;
  if (input.codeMode !== undefined) d.codeMode = input.codeMode;
  if (input.sharedCode !== undefined) d.sharedCode = input.sharedCode?.trim().toUpperCase() || null;
  if (input.codePrefix !== undefined) d.codePrefix = normalizePrefix(input.codePrefix) || null;
  if (input.redeemMode !== undefined) d.redeemMode = input.redeemMode;
  if (input.staffCode !== undefined) d.staffCode = input.staffCode?.trim() || null;
  if (input.totalLimit !== undefined) d.totalLimit = input.totalLimit;
  if (input.perContactLimit !== undefined) d.perContactLimit = input.perContactLimit;
  if (input.claimTagId !== undefined) d.claimTagId = input.claimTagId || null;
  return d;
}

export async function listCoupons(
  db: TenantDb,
  tenantId: string,
  opts: { status?: string; purpose?: string; q?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const where: Prisma.CouponWhereInput = { tenantId };
  if (opts.status) where.status = opts.status as Prisma.CouponWhereInput['status'];
  if (opts.purpose) where.purpose = opts.purpose as Prisma.CouponWhereInput['purpose'];
  if (opts.q) where.name = { contains: opts.q, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    db.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.coupon.count({ where }),
  ]);
  return { items, total, page, limit };
}

export async function getCoupon(db: TenantDb, tenantId: string, id: string) {
  return db.coupon.findFirst({ where: { id, tenantId } });
}

export async function createCoupon(db: TenantDb, tenantId: string, createdById: string, input: CouponInput) {
  if (!input.name?.trim()) throw new CouponValidationError('券名稱不可為空');
  if (!input.couponType) throw new CouponValidationError('請選擇券型');
  validateCouponShape(input);

  return db.coupon.create({
    data: {
      ...(buildData(input) as Prisma.CouponUncheckedCreateInput),
      tenantId,
      createdById,
      name: input.name.trim(),
      couponType: input.couponType,
    },
  });
}

export async function updateCoupon(db: TenantDb, tenantId: string, id: string, input: CouponInput) {
  const existing = await db.coupon.findFirst({ where: { id, tenantId } });
  if (!existing) return null;
  // 已結束的券不再接受編輯——避免改動影響既已發出的券之認定
  if (existing.status === 'ENDED') {
    throw new CouponValidationError('已結束的券無法編輯');
  }
  validateCouponShape(input, existing);

  const data = buildData(input);
  const result = await db.coupon.updateMany({ where: { id, tenantId }, data });
  if (result.count === 0) return null;
  return db.coupon.findFirst({ where: { id, tenantId } });
}

export async function deleteCoupon(db: TenantDb, tenantId: string, id: string) {
  const existing = await db.coupon.findFirst({ where: { id, tenantId } });
  if (!existing) return { deleted: false as const, reason: 'NOT_FOUND' as const };
  // 已發出的券不可刪——顧客手上還有券，刪掉會讓核銷時查無此券
  const issued = await db.couponInstance.count({ where: { couponId: id, tenantId } });
  if (issued > 0) {
    return { deleted: false as const, reason: 'HAS_INSTANCES' as const, issued };
  }
  await db.coupon.deleteMany({ where: { id, tenantId } });
  return { deleted: true as const };
}
