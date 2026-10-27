/**
 * 店員核銷台的入口（公開端點，沒有登入的座席）：租戶由門市憑證或帳號名稱決定，
 * 這裡以 inTenant() 開交易，再呼叫只收 TenantCtx 的 service（AGENTS.md 結構規則 2）。
 * 核銷的重試鍵（Redis）也在這裡處理：它包住整個交易，不屬於交易內的邏輯。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { couponCodeKey } from '@open333crm/core';
import { inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import { notifyInstanceUpdated } from '../coupon/coupon-effects.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import {
  authorizeStoreSession,
  listTodayRedemptions,
  loginStoreAccount,
  lookupStoreCoupon,
  normalizeStoreUsername,
  redeemStoreCoupon,
  type StoreLoginResult,
  type StoreRedeemResult,
  type StoreSession,
} from './store-console.service.js';

export interface StoreConsoleFlowDeps {
  prisma: PrismaClient;
  /** commit 後推播券狀態更新 */
  io: Server;
  /** 重試鍵的儲存（Redis；測試用記憶體版本） */
  store: BindingStore;
  now?: () => number;
  /** 依帳號名稱找出租戶。正式版在 modules/auth 以 BYPASSRLS 連線查（登入前還不知道租戶） */
  resolveTenant: (username: string) => Promise<string | null>;
}

const MIN_MS = 60 * 1000;
/** 重試鍵保留多久：店員在網路恢復後重送，通常在幾十秒內 */
const IDEMPOTENCY_TTL_MS = 10 * MIN_MS;

function inSessionTenant<T>(deps: StoreConsoleFlowDeps, session: StoreSession, fn: (scope: TenantScope) => Promise<T>) {
  return inTenant(deps.prisma, session.tenantId, fn);
}

/** 門市帳號登入：先依帳號名稱找出租戶，再在該租戶的交易內檢查密碼 */
export async function loginStoreAccountFlow(
  deps: StoreConsoleFlowDeps,
  rawUsername: string,
  password: string,
  remember: boolean,
): Promise<StoreLoginResult> {
  const username = normalizeStoreUsername(rawUsername);
  const tenantId = await deps.resolveTenant(username);
  if (!tenantId) return { ok: false, code: 'INVALID_CREDENTIALS' };
  const now = new Date((deps.now ?? Date.now)());
  return inTenant(deps.prisma, tenantId, (ctx) =>
    loginStoreAccount(ctx, username, password, remember, now));
}

export function authorizeStoreSessionFlow(
  deps: StoreConsoleFlowDeps,
  session: StoreSession,
  opts: { requireRedeem: boolean },
) {
  return inSessionTenant(deps, session, (ctx) => authorizeStoreSession(ctx, session, opts));
}

export function lookupStoreCouponFlow(deps: StoreConsoleFlowDeps, session: StoreSession, rawCode: string, now?: number) {
  return inSessionTenant(deps, session, (ctx) => lookupStoreCoupon(ctx, rawCode, now));
}

export function listTodayRedemptionsFlow(deps: StoreConsoleFlowDeps, session: StoreSession, now?: number) {
  return inSessionTenant(deps, session, (ctx) => listTodayRedemptions(ctx, session, now));
}

const idempotencyKey = (accountId: string, key: string) => `store-redeem:${accountId}:${key}`;

function reviveDates(r: StoreRedeemResult): StoreRedeemResult {
  const date = (v: unknown) => (v ? new Date(v as string) : undefined);
  const coupon = r.coupon
    ? { ...r.coupon, startAt: date(r.coupon.startAt) ?? null, endAt: date(r.coupon.endAt) ?? null, expiresAt: date(r.coupon.expiresAt) ?? null }
    : undefined;
  return r.ok
    ? { ...r, redeemedAt: new Date(r.redeemedAt), coupon: coupon! }
    : { ...r, coupon, redeemedAt: date(r.redeemedAt) };
}

/**
 * 確認核銷。同一個重試鍵在 10 分鐘內回傳第一次的結果（網路逾時後重送不會重複核銷，也不會誤報已使用）。
 * 兩台手機同時核銷時，交易內的條件式更新只讓一個成功；另一個回報已使用並附核銷門市。
 */
export async function redeemAtStore(
  deps: StoreConsoleFlowDeps,
  session: StoreSession,
  rawCode: string,
  key: string,
): Promise<StoreRedeemResult> {
  const cacheKey = idempotencyKey(session.accountId, key);
  // 重試鍵綁定券號：同一個鍵換成別張券，不回傳上一張券的結果
  const codeKey = couponCodeKey(rawCode);
  // 先佔住重試鍵再核銷：第一個請求還在處理時重送，等它的結果，不再核銷一次
  //（否則第二次會撞「已使用」，店員看到已使用而拒收）
  const claimed = await deps.store.set(cacheKey, JSON.stringify({ pending: true, code: codeKey }), 'PX', IDEMPOTENCY_TTL_MS, 'NX');
  if (claimed !== 'OK') return waitForResult(deps.store, cacheKey, codeKey);

  let result: StoreRedeemResult;
  try {
    const now = (deps.now ?? Date.now)();
    result = await inSessionTenant(deps, session, async (scope) => {
      const outcome = await redeemStoreCoupon(scope, session, rawCode, now);
      // 收件匣「已發優惠券」重新載入（design D23），commit 後送出
      if (outcome.redeemed) notifyInstanceUpdated(scope, deps.io, { ...outcome.redeemed, change: 'redeemed' });
      return outcome.result;
    });
  } catch (err) {
    await deps.store.getdel(cacheKey);
    throw err;
  }
  // 以 XX 直接把「處理中」換成結果：先刪再寫會留下空窗，重送的請求會趁空窗再核銷一次
  await deps.store.set(cacheKey, JSON.stringify({ code: codeKey, result }), 'PX', IDEMPOTENCY_TTL_MS, 'XX');
  return result;
}

/** 等待同一個重試鍵的第一個請求完成的最長時間 */
const WAIT_RESULT_MS = 10_000;
const WAIT_STEP_MS = 100;

/** 核銷台的「處理中」：第一個請求在等待時間內沒有完成，請店員稍後再按（沿用同一個重試鍵） */
export class StoreRedeemInProgressError extends Error {
  constructor() {
    super('上一次核銷還在處理中');
    this.name = 'StoreRedeemInProgressError';
  }
}

async function waitForResult(store: BindingStore, cacheKey: string, codeKey: string): Promise<StoreRedeemResult> {
  for (let waited = 0; waited <= WAIT_RESULT_MS; waited += WAIT_STEP_MS) {
    const raw = await store.get(cacheKey);
    // 第一個請求失敗並清掉了鍵：結果不明，交給店員重送
    if (!raw) break;
    const stored = JSON.parse(raw) as { pending?: boolean; code?: string; result?: StoreRedeemResult };
    if (stored.code !== codeKey) return { ok: false, reason: 'KEY_REUSED' };
    if (stored.result) return reviveDates(stored.result);
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
  }
  throw new StoreRedeemInProgressError();
}

