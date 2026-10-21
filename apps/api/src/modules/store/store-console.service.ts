/**
 * 店員核銷台（add-coupon-system A10、design D13）：門市帳號登入、帳號狀態檢查、
 * 查券（不改變狀態）、核銷（記錄門市、重試鍵防重複）、今日核銷紀錄。
 *
 * 門市憑證是 JWT（sub 'store'、typ 'store'），沒有 agentId，後台的 isAgentAccessToken 一律拒收。
 * 憑證帶帳號的 passwordVersion 與 sessionVersion，每次操作都與資料庫比對。
 *
 * 函式收 TenantCtx；租戶由門市憑證或帳號名稱決定，交易由 store-console.flow.ts 開（AGENTS.md 結構規則 2）。
 */
import jwt from 'jsonwebtoken';
import { couponCodeKey } from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { verifyPassword } from '../../shared/utils/password.js';
import { walletStatusOf } from '../coupon/coupon-fan.service.js';
import { redeemCoupon } from '../coupon/coupon-redeem.service.js';

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
/** 連續輸入錯誤密碼幾次後鎖定，以及鎖定多久 */
export const MAX_LOGIN_FAILURES = 5;
export const LOCK_MS = 15 * MIN_MS;
const REMEMBER_EXPIRES = '30d';
const SESSION_EXPIRES = '12h';
/** 台灣不實施日光節約時間，「今天」固定以 UTC+8 計算 */
const TAIPEI_OFFSET_MS = 8 * 60 * MIN_MS;

// ── 門市憑證 ──────────────────────────────────────────────────────────────

export interface StoreSession {
  accountId: string;
  tenantId: string;
  storeId: string;
  /** passwordVersion 與 sessionVersion 的快照 */
  pv: number;
  sv: number;
}

function signStoreToken(session: StoreSession, remember: boolean): string {
  return jwt.sign({ sub: 'store', typ: 'store', ...session }, getConfig().JWT_SECRET, {
    expiresIn: remember ? REMEMBER_EXPIRES : SESSION_EXPIRES,
  });
}

/** 驗證門市憑證；簽章錯誤、過期或不是門市憑證回 null */
export function verifyStoreToken(token: string): StoreSession | null {
  try {
    const p = jwt.verify(token, getConfig().JWT_SECRET) as Record<string, unknown>;
    if (p.sub !== 'store' || p.typ !== 'store') return null;
    if (typeof p.accountId !== 'string' || typeof p.tenantId !== 'string' || typeof p.storeId !== 'string') return null;
    return { accountId: p.accountId, tenantId: p.tenantId, storeId: p.storeId, pv: Number(p.pv), sv: Number(p.sv) };
  } catch {
    return null;
  }
}

/** 門市憑證是否已過期（用來區分「登入已過期」與「憑證無效」） */
export function isExpiredStoreToken(token: string): boolean {
  try {
    jwt.verify(token, getConfig().JWT_SECRET);
    return false;
  } catch (err) {
    return (err as { name?: string }).name === 'TokenExpiredError';
  }
}

// ── 登入 ──────────────────────────────────────────────────────────────────

export type StoreLoginResult =
  | { ok: true; token: string; storeName: string; username: string; canRedeem: boolean }
  | { ok: false; code: 'INVALID_CREDENTIALS' }
  | { ok: false; code: 'ACCOUNT_LOCKED'; lockedUntil: Date }
  | { ok: false; code: 'STORE_ACCOUNT_DISABLED' | 'STORE_CLOSED' | 'TENANT_DISABLED' };

/** 帳號名稱的比對格式：前後空白不算、不分大小寫 */
export const normalizeStoreUsername = (raw: string) => raw.trim().toLowerCase();

/**
 * 門市帳號登入（ctx 為帳號所屬租戶的交易）。帳號不存在與密碼錯誤回報相同結果，不透露帳號是否存在。
 * 停用與停業只在密碼正確時才回報，避免拿來探測帳號。
 */
export async function loginStoreAccount(
  ctx: TenantCtx,
  username: string,
  password: string,
  remember: boolean,
  now: Date,
): Promise<StoreLoginResult> {
  const { tx, tenantId } = ctx;
  // 鎖住這個帳號到交易結束：同時送出多個錯誤密碼時依序計數，不會各自讀到 0 再寫回 1 而永遠不鎖定
  await tx.$queryRaw`
    SELECT id FROM store_accounts
    WHERE username = ${username} AND "tenantId" = ${tenantId}::uuid AND "deletedAt" IS NULL
    FOR UPDATE`;
  const account = await tx.storeAccount.findFirst({
    where: { username, tenantId, deletedAt: null },
    include: { store: { select: { name: true, isActive: true } }, tenant: { select: { isActive: true } } },
  });
  if (!account) return { ok: false as const, code: 'INVALID_CREDENTIALS' as const };
  if (account.lockedUntil && account.lockedUntil > now) {
    return { ok: false as const, code: 'ACCOUNT_LOCKED' as const, lockedUntil: account.lockedUntil };
  }

  if (!(await verifyPassword(password, account.passwordHash))) {
    // 鎖定期滿後重新計算錯誤次數
    const failures = (account.lockedUntil ? 0 : account.failedLoginCount) + 1;
    if (failures >= MAX_LOGIN_FAILURES) {
      const lockedUntil = new Date(now.getTime() + LOCK_MS);
      await tx.storeAccount.updateMany({
        where: { id: account.id, tenantId },
        data: { failedLoginCount: 0, lockedUntil },
      });
      return { ok: false as const, code: 'ACCOUNT_LOCKED' as const, lockedUntil };
    }
    await tx.storeAccount.updateMany({
      where: { id: account.id, tenantId },
      data: { failedLoginCount: failures, lockedUntil: null },
    });
    return { ok: false as const, code: 'INVALID_CREDENTIALS' as const };
  }

  await tx.storeAccount.updateMany({
    where: { id: account.id, tenantId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  // 租戶停用（試用到期、合約終止）時與座席登入一致擋下
  if (!account.tenant?.isActive) return { ok: false as const, code: 'TENANT_DISABLED' as const };
  if (!account.isActive) return { ok: false as const, code: 'STORE_ACCOUNT_DISABLED' as const };
  if (!account.store.isActive) return { ok: false as const, code: 'STORE_CLOSED' as const };

  const token = signStoreToken(
    { accountId: account.id, tenantId, storeId: account.storeId, pv: account.passwordVersion, sv: account.sessionVersion },
    remember,
  );
  return { ok: true as const, token, storeName: account.store.name, username, canRedeem: account.canRedeem };
}

// ── 帳號狀態檢查 ───────────────────────────────────────────────────────────

export type StoreSessionError =
  | 'STORE_ACCOUNT_NOT_FOUND'
  | 'STORE_ACCOUNT_DISABLED'
  | 'NO_REDEEM_PERMISSION'
  | 'PASSWORD_CHANGED'
  | 'SESSION_REVOKED'
  | 'STORE_CLOSED'
  | 'TENANT_DISABLED';

export interface AuthorizedStore {
  ok: true;
  account: { id: string; username: string; canRedeem: boolean };
  store: { id: string; name: string };
}

/**
 * 檢查門市憑證對應的帳號與門市目前是否可用。核銷台每個 API 都呼叫（spec「核銷台每次操作都檢查帳號狀態」）。
 * requireRedeem 為 false 時（帳號資訊）不檢查核銷權限，讓前端能顯示「沒有核銷權限」的說明。
 */
export async function authorizeStoreSession(
  ctx: TenantCtx,
  session: StoreSession,
  opts: { requireRedeem: boolean },
): Promise<AuthorizedStore | { ok: false; code: StoreSessionError }> {
  const account = await ctx.tx.storeAccount.findFirst({
    where: { id: session.accountId, tenantId: ctx.tenantId },
    include: { store: { select: { id: true, name: true, isActive: true } }, tenant: { select: { isActive: true } } },
  });
  if (!account || account.deletedAt) return { ok: false, code: 'STORE_ACCOUNT_NOT_FOUND' };
  if (!account.tenant?.isActive) return { ok: false, code: 'TENANT_DISABLED' };
  if (account.passwordVersion !== session.pv) return { ok: false, code: 'PASSWORD_CHANGED' };
  if (account.sessionVersion !== session.sv) return { ok: false, code: 'SESSION_REVOKED' };
  if (!account.isActive) return { ok: false, code: 'STORE_ACCOUNT_DISABLED' };
  if (!account.store.isActive) return { ok: false, code: 'STORE_CLOSED' };
  if (opts.requireRedeem && !account.canRedeem) return { ok: false, code: 'NO_REDEEM_PERMISSION' };
  return {
    ok: true,
    account: { id: account.id, username: account.username, canRedeem: account.canRedeem },
    store: { id: account.store.id, name: account.store.name },
  };
}

// ── 查券 ──────────────────────────────────────────────────────────────────

/** 核銷台顯示的顧客名稱：保留頭尾字，中間以 ◯ 遮罩（最多 3 個）。店員只需要對得上人，不需要全名。 */
export function maskCustomerName(name: string | null | undefined): string {
  const chars = [...(name ?? '').trim()];
  if (chars.length === 0) return '顧客';
  if (chars.length === 1) return chars[0];
  if (chars.length === 2) return `${chars[0]}◯`;
  return `${chars[0]}${'◯'.repeat(Math.min(chars.length - 2, 3))}${chars[chars.length - 1]}`;
}

/** 券號正規化：去掉連字號、空白與其他符號並轉大寫。比對時兩邊都這樣處理，店員不用打連字號。 */

/** SHARED_CODE：輸入的是共用碼券的共用券號，所有持有者相同，分不出是哪一位顧客 */
export type LookupResult =
  | 'OK' | 'USED' | 'EXPIRED' | 'NOT_YET' | 'ENDED' | 'WRONG_MODE' | 'NOT_CLAIMED' | 'NOT_FOUND' | 'SHARED_CODE';

export interface StoreCouponView {
  instanceId: string;
  code: string;
  name: string;
  couponType: string | null;
  discountAmount: number | null;
  discountPercent: number | null;
  minSpend: number | null;
  percentCap: number | null;
  giftName: string | null;
  giftQty: number | null;
  exchangeItem: string | null;
  exchangeValueCap: number | null;
  redeemMode: string | null;
  validityMode: string | null;
  startAt: Date | null;
  endAt: Date | null;
  expiresAt: Date | null;
  customerName: string;
}

export interface StoreLookup {
  result: LookupResult;
  coupon?: StoreCouponView;
  redeemedAt?: Date;
  redeemedStoreName?: string | null;
  expiresAt?: Date;
  availableAt?: Date;
}

/**
 * 以券號找出這個租戶的券（忽略連字號與大小寫）。查無或屬於其他租戶都回 null。
 * 比對運算式必須與唯一索引 coupon_instances_tenantId_code_key_norm 相同，才會走索引且最多一筆。
 */
async function findInstanceByCode(ctx: TenantCtx, rawCode: string) {
  const { tx, tenantId } = ctx;
  const key = couponCodeKey(rawCode);
  if (!key) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM coupon_instances
    WHERE "tenantId" = ${tenantId}::uuid
      AND upper(regexp_replace("code", '[^A-Za-z0-9]', '', 'g')) = ${key}`;
  if (rows.length === 0) return null;
  return tx.couponInstance.findFirst({
    where: { id: rows[0].id, tenantId },
    include: { coupon: true, contact: { select: { displayName: true } } },
  });
}

type FoundInstance = NonNullable<Awaited<ReturnType<typeof findInstanceByCode>>>;

function toStoreView(i: FoundInstance): StoreCouponView {
  return {
    instanceId: i.id,
    code: i.code,
    name: i.coupon.name,
    couponType: i.coupon.couponType,
    discountAmount: i.coupon.discountAmount,
    discountPercent: i.coupon.discountPercent,
    minSpend: i.coupon.minSpend,
    percentCap: i.coupon.percentCap,
    giftName: i.coupon.giftName,
    giftQty: i.coupon.giftQty,
    exchangeItem: i.coupon.exchangeItem,
    exchangeValueCap: i.coupon.exchangeValueCap,
    redeemMode: i.coupon.redeemMode,
    validityMode: i.coupon.validityMode,
    startAt: i.coupon.startAt,
    endAt: i.coupon.endAt,
    expiresAt: i.expiresAt,
    customerName: maskCustomerName(i.contact?.displayName),
  };
}

function judge(i: FoundInstance, now: number): StoreLookup {
  const coupon = toStoreView(i);
  if (i.status === 'ISSUED') return { result: 'NOT_CLAIMED', coupon };
  const { walletStatus } = walletStatusOf(i, i.coupon, now);
  switch (walletStatus) {
    case 'USED':
      return { result: 'USED', coupon, redeemedAt: i.redeemedAt ?? undefined, redeemedStoreName: i.redeemedStoreName };
    case 'EXPIRED':
      return { result: 'EXPIRED', coupon, expiresAt: i.expiresAt ?? undefined };
    case 'ENDED':
      return { result: 'ENDED', coupon };
    case 'NOT_YET':
      return { result: 'NOT_YET', coupon, availableAt: i.coupon.startAt ?? undefined };
  }
  // 店員驗證碼券與顧客自助券在顧客手機上核銷，核銷台只核銷店員掃碼券
  if (i.coupon.redeemMode !== 'STAFF_SCAN') return { result: 'WRONG_MODE', coupon };
  return { result: 'OK', coupon };
}

/** 查券：只讀，不改變券的狀態 */
export async function lookupStoreCoupon(ctx: TenantCtx, rawCode: string, now: number = Date.now()): Promise<StoreLookup> {
  const instance = await findInstanceByCode(ctx, rawCode);
  if (!instance) return { result: (await isSharedCode(ctx, rawCode)) ? 'SHARED_CODE' : 'NOT_FOUND' };
  return judge(instance, now);
}

/** 輸入的是否為某張共用碼券的共用券號（共用碼存為大寫英數） */
async function isSharedCode(ctx: TenantCtx, rawCode: string): Promise<boolean> {
  const key = couponCodeKey(rawCode);
  if (!key) return false;
  const coupon = await ctx.tx.coupon.findFirst({
    where: { tenantId: ctx.tenantId, codeMode: 'SHARED_CODE', sharedCode: key },
    select: { id: true },
  });
  return coupon != null;
}

// ── 核銷 ──────────────────────────────────────────────────────────────────

export type StoreRedeemFailure =
  | 'NOT_FOUND'
  | 'ALREADY_REDEEMED'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'REVOKED'
  | 'WRONG_MODE'
  | 'NOT_CLAIMED'
  /** 開啟後計時的券顧客還沒開啟 */
  | 'NOT_OPENED'
  | 'SHARED_CODE'
  /** 同一個重試鍵用在另一張券（前端每次確認都產生新鍵，正常操作不會發生） */
  | 'KEY_REUSED';

export type StoreRedeemResult =
  | { ok: true; redeemedAt: Date; storeName: string; coupon: StoreCouponView }
  | { ok: false; reason: StoreRedeemFailure; coupon?: StoreCouponView; redeemedAt?: Date; redeemedStoreName?: string | null };

const LOOKUP_FAILURE: Record<Exclude<LookupResult, 'OK'>, StoreRedeemFailure> = {
  USED: 'ALREADY_REDEEMED',
  EXPIRED: 'EXPIRED',
  NOT_YET: 'NOT_YET_VALID',
  ENDED: 'REVOKED',
  WRONG_MODE: 'WRONG_MODE',
  NOT_CLAIMED: 'NOT_CLAIMED',
  NOT_FOUND: 'NOT_FOUND',
  SHARED_CODE: 'SHARED_CODE',
};

/**
 * 核銷一次（不含重試鍵，重試鍵由 flow 處理）。查券、記錄門市與核銷在同一個交易內；
 * 兩台手機同時核銷時，條件式更新只讓一個成功，另一個回報已使用並附核銷門市。
 * 成功時由 redeemCoupon 推播券狀態更新（commit 後送出，design D23）。
 */
export async function redeemStoreCoupon(
  ctx: TenantCtx,
  session: StoreSession,
  rawCode: string,
  now: number,
): Promise<StoreRedeemResult> {
  const instance = await findInstanceByCode(ctx, rawCode);
  if (!instance) {
    return { ok: false, reason: (await isSharedCode(ctx, rawCode)) ? 'SHARED_CODE' : 'NOT_FOUND' };
  }
  const lookup = judge(instance, now);
  if (lookup.result !== 'OK') {
    return {
      ok: false,
      reason: LOOKUP_FAILURE[lookup.result],
      coupon: lookup.coupon,
      redeemedAt: lookup.redeemedAt,
      redeemedStoreName: lookup.redeemedStoreName,
    };
  }

  const who = await ctx.tx.storeAccount.findFirst({
    where: { id: session.accountId, tenantId: ctx.tenantId },
    select: { username: true, store: { select: { id: true, name: true } } },
  });
  if (!who) return { ok: false, reason: 'NOT_FOUND' };

  const redeemed = await redeemCoupon(ctx, {
    instanceId: instance.id,
    redeemedBy: null,
    redeemChannel: 'store_console',
    onlyMode: 'STAFF_SCAN',
    store: { id: who.store.id, name: who.store.name, account: who.username },
  });
  if (redeemed.ok) {
    return { ok: true, redeemedAt: redeemed.redeemedAt, storeName: who.store.name, coupon: lookup.coupon! };
  }
  if (redeemed.reason === 'CONFLICT' || redeemed.reason === 'ALREADY_REDEEMED') {
    // 被另一台手機搶先：重新讀出是哪間門市、什麼時候核銷的
    const latest = await findInstanceByCode(ctx, rawCode);
    return {
      ok: false,
      reason: 'ALREADY_REDEEMED',
      coupon: lookup.coupon,
      redeemedAt: latest?.redeemedAt ?? undefined,
      redeemedStoreName: latest?.redeemedStoreName ?? null,
    };
  }
  const reason: StoreRedeemFailure =
    redeemed.reason === 'SELF_REDEEM_NOT_ALLOWED' || redeemed.reason === 'WRONG_MODE'
      ? 'WRONG_MODE'
      : (redeemed.reason as StoreRedeemFailure);
  return { ok: false, reason, coupon: lookup.coupon };
}

// ── 今日核銷紀錄 ───────────────────────────────────────────────────────────

/** 台灣時間今天 00:00 的時間點 */
function startOfTaipeiDay(now: number): Date {
  return new Date(Math.floor((now + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS);
}

/**
 * 本門市今天（台灣時間）在核銷台核銷的紀錄，時間由新到舊。
 * 折抵總額只計元折抵券的面額——% 折扣券的實際折抵金額要看消費金額，流程中沒有輸入（design D13 待 PM）。
 */
export async function listTodayRedemptions(ctx: TenantCtx, session: StoreSession, now: number = Date.now()) {
  const from = startOfTaipeiDay(now);
  const rows = await ctx.tx.couponInstance.findMany({
    where: {
      tenantId: ctx.tenantId,
      redeemedStoreId: session.storeId,
      status: 'REDEEMED',
      redeemedAt: { gte: from, lt: new Date(from.getTime() + DAY_MS) },
    },
    include: { coupon: true, contact: { select: { displayName: true } } },
    orderBy: { redeemedAt: 'desc' },
    take: 500,
  });
  const items = rows.map((r) => ({ ...toStoreView(r), redeemedAt: r.redeemedAt as Date }));
  const summary = { count: items.length, discountTotal: 0, giftCount: 0, exchangeCount: 0 };
  for (const item of items) {
    if (item.couponType === 'DISCOUNT_AMOUNT') summary.discountTotal += item.discountAmount ?? 0;
    if (item.couponType === 'GIFT') summary.giftCount += 1;
    if (item.couponType === 'EXCHANGE') summary.exchangeCount += 1;
  }
  return { items, summary, date: from };
}
