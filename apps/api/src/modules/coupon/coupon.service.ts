/**
 * 優惠券 service —— 券主檔的 CRUD、列表與複製。
 *
 * 租戶隔離：所有函式收 TenantDb（已綁租戶的連線），並仍帶 where tenantId ——
 * 應用層與 RLS 兩層都要顧，不可因為有 RLS 就省略 where（見 check-tenant-scoping.mjs）。
 *
 * 草稿只要求券名；其餘必填在發布時由 coupon-lifecycle.service 的 validateForPublish 檢查。
 */
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { sanitizeTerms } from './terms-sanitizer.js';
import { normalizePrefix } from './coupon-code.service.js';
import { staffCodeError, findLockedChanges } from './coupon-rules.js';

export interface CouponInput {
  name?: string;
  description?: string | null;
  terms?: string | null;
  imageUrl?: string | null;
  couponType?: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE' | null;
  purpose?: 'MARKETING' | 'SERVICE' | null;
  discountAmount?: number | null;
  discountPercent?: number | null;
  minSpend?: number | null;
  percentCap?: number | null;
  giftName?: string | null;
  giftQty?: number | null;
  exchangeItem?: string | null;
  exchangeValueCap?: number | null;
  validityMode?: 'FIXED' | 'AFTER_CLAIM' | 'AFTER_OPEN' | null;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
  afterClaimDays?: number | null;
  afterOpenMinutes?: number | null;
  codeMode?: 'SHARED_CODE' | 'UNIQUE_CODE' | 'IMPORTED_CODES' | null;
  sharedCode?: string | null;
  codePrefix?: string | null;
  redeemMode?: 'STAFF_CODE' | 'STAFF_SCAN' | 'SELF' | null;
  staffCode?: string | null;
  totalLimit?: number | null;
  perContactLimit?: number;
  claimTagId?: string | null;
  claimTagTtlDays?: number | null;
  maskCodeBeforeStart?: boolean;
}

/** 欄位驗證失敗時拋此錯，route 層轉 400；與其他錯誤（500）區分開。 */
export class CouponValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponValidationError';
  }
}

/** 改到發布後鎖定的欄位時拋此錯，route 層轉 409。 */
export class CouponLockedError extends Error {
  constructor(public readonly fields: string[]) {
    super('優惠券發布後無法修改');
    this.name = 'CouponLockedError';
  }
}

/** 與同租戶其他券衝突（例如共用碼重複）時拋此錯，route 層轉 409。 */
export class CouponConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CouponConflictError';
  }
}

type ExistingCoupon = Prisma.CouponGetPayload<Record<string, never>>;

function toDate(v: string | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new CouponValidationError('日期格式不正確');
  return d;
}

function positiveIntOrNull(value: number | null | undefined, message: string): void {
  if (value != null && (!Number.isInteger(value) || value <= 0)) throw new CouponValidationError(message);
}

/** 本次輸入有給就用輸入值，沒給就沿用既有值——欄位間的檢查要看合併後的結果。 */
function merged<K extends keyof CouponInput>(input: CouponInput, existing: Partial<ExistingCoupon> | undefined, key: K) {
  if (input[key] !== undefined) return input[key];
  return (existing as Record<string, unknown> | undefined)?.[key as string] as CouponInput[K];
}

/**
 * 驗證欄位格式與欄位間的相依關係。這些在 DB 層無法用約束表達（會隨券型、模式變動），只能在此集中驗。
 * 草稿也會檢查——填了的值必須正確；沒填的必填欄位留給發布時檢查。
 */
function validateCouponShape(input: CouponInput, existing?: Partial<ExistingCoupon>): void {
  if (input.discountAmount != null) positiveIntOrNull(input.discountAmount, '金額需大於 0，例如輸入 100');
  if (input.minSpend != null && (!Number.isInteger(input.minSpend) || input.minSpend < 0)) {
    throw new CouponValidationError('門檻不能是負數，輸入 0 表示不限');
  }
  if (merged(input, existing, 'couponType') === 'DISCOUNT_AMOUNT') {
    const amount = merged(input, existing, 'discountAmount');
    const minSpend = merged(input, existing, 'minSpend');
    if (amount != null && minSpend != null && minSpend > 0 && amount >= minSpend) {
      throw new CouponValidationError(`折抵金額需小於最低消費門檻 NT$${minSpend}`);
    }
  }
  const pct = input.discountPercent;
  if (pct != null && (!Number.isInteger(pct) || pct < 1 || pct > 99)) {
    throw new CouponValidationError('折扣比例只能是 1–99');
  }
  positiveIntOrNull(input.percentCap, '折抵上限需大於 0；不設上限請留空');
  positiveIntOrNull(input.exchangeValueCap, '價值上限需大於 0；不設上限請留空');
  positiveIntOrNull(input.giftQty, '數量至少 1 份');

  if (merged(input, existing, 'validityMode') === 'FIXED') {
    const s = toDate(merged(input, existing, 'startAt'));
    const e = toDate(merged(input, existing, 'endAt'));
    if (s && e && s >= e) throw new CouponValidationError('失效日必須晚於生效日');
  }
  positiveIntOrNull(input.afterClaimDays, '至少 1 天，請輸入 1 以上的數字');
  positiveIntOrNull(input.afterOpenMinutes, '至少 1 分鐘，請輸入 1 以上的數字');

  if (input.sharedCode != null && input.sharedCode !== '' && !/^[A-Za-z0-9]{4,20}$/.test(input.sharedCode.trim())) {
    throw new CouponValidationError('共用碼需為 4–20 字的英文與數字');
  }
  if (input.staffCode != null && input.staffCode !== '') {
    const err = staffCodeError(input.staffCode.trim());
    if (err) throw new CouponValidationError(err);
  }

  positiveIntOrNull(input.totalLimit, '至少 1 張的整數；不限總量請留空');
  positiveIntOrNull(input.perContactLimit, '每人領取上限至少 1 張');
  positiveIntOrNull(input.claimTagTtlDays, '標籤時效至少 1 天');
  const total = merged(input, existing, 'totalLimit');
  const perContact = merged(input, existing, 'perContactLimit');
  if (total != null && perContact != null && perContact > total) {
    throw new CouponValidationError(`每人領取上限不能大於發行總量（${total} 張）`);
  }
}

const TRIMMED_TEXT = ['description', 'imageUrl', 'giftName', 'exchangeItem'] as const;
const PASS_THROUGH = [
  'couponType', 'purpose', 'discountAmount', 'discountPercent', 'minSpend', 'percentCap', 'giftQty',
  'exchangeValueCap', 'validityMode', 'afterClaimDays', 'afterOpenMinutes', 'codeMode', 'redeemMode',
  'totalLimit', 'perContactLimit', 'claimTagTtlDays', 'maskCodeBeforeStart',
] as const;

/** 把 input 轉成 Prisma 欄位；只處理有給的欄位，未給者不動（支援部分更新）。 */
function buildData(input: CouponInput): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name?.trim();
    if (!name) throw new CouponValidationError('請先填寫優惠券名稱');
    d.name = name;
  }
  for (const key of TRIMMED_TEXT) {
    if (input[key] !== undefined) d[key] = input[key]?.trim() || null;
  }
  for (const key of PASS_THROUGH) {
    if (input[key] !== undefined) d[key] = input[key];
  }
  // 條款一律消毒後才入庫，避免髒資料落地（design D9）
  if (input.terms !== undefined) d.terms = sanitizeTerms(input.terms);
  if (input.startAt !== undefined) d.startAt = toDate(input.startAt);
  if (input.endAt !== undefined) d.endAt = toDate(input.endAt);
  if (input.sharedCode !== undefined) d.sharedCode = input.sharedCode?.trim().toUpperCase() || null;
  if (input.codePrefix !== undefined) d.codePrefix = normalizePrefix(input.codePrefix) || null;
  // 驗證碼保留原字串（含開頭的 0），只去掉前後空白
  if (input.staffCode !== undefined) d.staffCode = input.staffCode?.trim() || null;
  if (input.claimTagId !== undefined) d.claimTagId = input.claimTagId || null;
  return d;
}

/** 共用碼不可與同租戶其他券重複；跨租戶可以相同。 */
async function assertSharedCodeAvailable(db: TenantDb, tenantId: string, sharedCode: string | null | undefined, selfId?: string) {
  const code = sharedCode?.trim().toUpperCase();
  if (!code) return;
  const other = await db.coupon.findFirst({
    where: { tenantId, sharedCode: code, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { name: true },
  });
  if (other) throw new CouponConflictError(`與其他券重複（${other.name}），請換一組券號`);
}

/** 共用碼是否可用，供表單即時檢查。 */
export async function checkSharedCode(db: TenantDb, tenantId: string, sharedCode: string, excludeId?: string) {
  try {
    await assertSharedCodeAvailable(db, tenantId, sharedCode, excludeId);
    return { available: true as const };
  } catch (err) {
    if (err instanceof CouponConflictError) return { available: false as const, message: err.message };
    throw err;
  }
}

/** 券號字元：去掉容易看錯的 0/O、1/I/L。 */
const DISPLAY_CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generateDisplayCode(): string {
  let s = 'CP-';
  for (let i = 0; i < 6; i++) s += DISPLAY_CODE_CHARS[randomInt(DISPLAY_CODE_CHARS.length)];
  return s;
}

function isDisplayCodeCollision(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    String((err.meta as { target?: unknown } | undefined)?.target ?? '').includes('displayCode')
  );
}

/** 建立券並配一組券號；券號撞號時換一組重試（31^6 組合，實務上極少發生）。 */
async function insertWithDisplayCode(db: TenantDb, data: Record<string, unknown>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.coupon.create({
        data: { ...data, displayCode: generateDisplayCode() } as Prisma.CouponUncheckedCreateInput,
      });
    } catch (err) {
      if (!isDisplayCodeCollision(err)) throw err;
    }
  }
  throw new Error('無法產生不重複的券號');
}

export async function createCoupon(db: TenantDb, tenantId: string, createdById: string, input: CouponInput) {
  if (!input.name?.trim()) throw new CouponValidationError('請先填寫優惠券名稱');
  validateCouponShape(input);
  await assertSharedCodeAvailable(db, tenantId, input.sharedCode);
  return insertWithDisplayCode(db, { ...buildData(input), tenantId, createdById });
}

export async function getCoupon(db: TenantDb, tenantId: string, id: string) {
  return db.coupon.findFirst({ where: { id, tenantId } });
}

export async function updateCoupon(db: TenantDb, tenantId: string, id: string, input: CouponInput) {
  const existing = await db.coupon.findFirst({ where: { id, tenantId } });
  if (!existing) return null;
  // 已結束的券不再接受編輯——避免改動影響既已發出的券之認定
  if (existing.status === 'ENDED') {
    throw new CouponValidationError('已結束的券無法編輯');
  }
  if (existing.status !== 'DRAFT') {
    const locked = findLockedChanges(existing, input as Record<string, unknown>);
    if (locked.length > 0) throw new CouponLockedError(locked);
  }
  validateCouponShape(input, existing);

  if (input.totalLimit != null) {
    const issued = await db.couponInstance.count({ where: { couponId: id, tenantId } });
    if (input.totalLimit < issued) throw new CouponValidationError(`不能低於已發放的 ${issued} 張`);
  }
  if (input.sharedCode !== undefined) await assertSharedCodeAvailable(db, tenantId, input.sharedCode, id);

  const result = await db.coupon.updateMany({ where: { id, tenantId }, data: buildData(input) });
  if (result.count === 0) return null;
  return db.coupon.findFirst({ where: { id, tenantId } });
}

type CountedStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ENDED';

/**
 * 後台券列表。搜尋比對券名與券號（不分大小寫）；狀態計數只套用搜尋、不套用狀態篩選，
 * 讓分頁標籤上的數字在切換狀態時保持不變。
 */
export async function listCoupons(
  db: TenantDb,
  tenantId: string,
  opts: { status?: string; purpose?: string; q?: string; page?: number; limit?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const base: Prisma.CouponWhereInput = { tenantId };
  if (opts.purpose) base.purpose = opts.purpose as Prisma.CouponWhereInput['purpose'];
  const q = opts.q?.trim();
  if (q) {
    base.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { displayCode: { contains: q, mode: 'insensitive' } },
    ];
  }
  const where: Prisma.CouponWhereInput = opts.status
    ? { ...base, status: opts.status as Prisma.CouponWhereInput['status'] }
    : base;

  // groupBy 在 TenantDb 聯集上無法推導多載（見 lib/tenant-db.ts 的說明），沿用專案既有寫法轉型
  const tx = db as Prisma.TransactionClient;
  const [coupons, total, grouped] = await Promise.all([
    db.coupon.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    db.coupon.count({ where }),
    tx.coupon.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
  ]);

  const statusCounts = { ALL: 0, ACTIVE: 0, PAUSED: 0, DRAFT: 0, ENDED: 0 };
  for (const g of grouped) {
    statusCounts[g.status as CountedStatus] = g._count._all;
    statusCounts.ALL += g._count._all;
  }

  const ids = coupons.map((c) => c.id);
  const instanceWhere = { tenantId, couponId: { in: ids } };
  const countBy = (extra: Prisma.CouponInstanceWhereInput) =>
    ids.length === 0
      ? Promise.resolve([] as { couponId: string; _count: { _all: number } }[])
      : tx.couponInstance.groupBy({ by: ['couponId'], where: { ...instanceWhere, ...extra }, _count: { _all: true } });
  const [issued, claimed, redeemed] = await Promise.all([
    countBy({}),
    // 已領取：曾經領取過的都算（含之後已核銷、已過期、已作廢），核銷率的分母才正確
    countBy({ claimedAt: { not: null } }),
    countBy({ status: 'REDEEMED' }),
  ]);
  const countOf = (rows: { couponId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.couponId === id)?._count._all ?? 0;

  const items = coupons.map((c) => ({
    ...c,
    issuedCount: countOf(issued, c.id),
    claimedCount: countOf(claimed, c.id),
    redeemedCount: countOf(redeemed, c.id),
  }));
  return { items, total, page, limit, statusCounts };
}

/**
 * 複製為新草稿。不複製店員驗證碼與共用碼（各券須不同，避免沿用後誤以為已設定），
 * 也不複製序號庫存；名稱加「（複製）」，券號重新產生。
 */
export async function duplicateCoupon(db: TenantDb, tenantId: string, id: string, createdById: string) {
  const src = await db.coupon.findFirst({ where: { id, tenantId } });
  if (!src) return null;
  const {
    id: _id, displayCode: _code, status: _status, createdAt: _created, updatedAt: _updated,
    createdById: _by, staffCode: _staff, sharedCode: _shared, name, ...settings
  } = src;
  return insertWithDisplayCode(db, { ...settings, name: copyName(name), status: 'DRAFT', createdById });
}

const COPY_SUFFIX = '（複製）';
const NAME_MAX = 30;

/** 複製後的名稱：加上「（複製）」且不超過券名上限，原名過長時截斷（不切斷 emoji） */
export function copyName(name: string): string {
  const chars = [...name];
  while (chars.length > 0 && (chars.join('') + COPY_SUFFIX).length > NAME_MAX) chars.pop();
  return chars.join('') + COPY_SUFFIX;
}

/** 只有草稿可以刪除；已發布的券只能提前結束（顧客手上可能有券，刪掉會讓核銷時查無此券）。 */
export async function deleteCoupon(db: TenantDb, tenantId: string, id: string) {
  const existing = await db.coupon.findFirst({ where: { id, tenantId } });
  if (!existing) return { deleted: false as const, reason: 'NOT_FOUND' as const };
  if (existing.status !== 'DRAFT') return { deleted: false as const, reason: 'NOT_DRAFT' as const };
  await db.coupon.deleteMany({ where: { id, tenantId, status: 'DRAFT' } });
  return { deleted: true as const };
}
