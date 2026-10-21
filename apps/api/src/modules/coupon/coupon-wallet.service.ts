/**
 * 顧客票券夾（add-coupon-system A9、design D12）：
 * - 票券連結換顧客憑證：已歸戶才發憑證，未歸戶回傳 One ID 登記頁網址
 * - 店員驗證碼核銷時段：5 分鐘內、最多錯 5 次
 *
 * 票券連結與核銷時段存在 Redis（deps.store），測試注入記憶體版本。
 */
import type { PrismaClient } from '@prisma/client';
import QRCode from 'qrcode';
import { readWalletToken } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { signFanToken } from '../portal/portal-auth.service.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { resolveLiveContactId } from '../identity-binding/binding-common.js';
import { getIdentityBindingSettings } from '../identity-binding/identity-binding.service.js';
import { issueRegistrationToken, type RegistrationKind } from '../identity-binding/identifier-registration.js';
import { PHONE_REGISTRATION } from '../identity-binding/phone-registration.service.js';
import { EMAIL_REGISTRATION } from '../identity-binding/email-registration.service.js';
import { getFanCoupon, listFanCoupons, type FanIdentity } from './coupon-fan.service.js';
import { redeemCoupon, type RedeemFailure } from './coupon-redeem.service.js';

export interface WalletDeps {
  store: BindingStore;
  now?: () => number;
}

const nowOf = (deps: WalletDeps) => (deps.now ?? Date.now)();

// ── 票券連結換顧客憑證 ─────────────────────────────────────────────────────

export type WalletSessionResult =
  | { status: 'ok'; fanToken: string; tenantId: string; contactId: string; instanceId: string }
  /** 未歸戶：帶顧客去登記，登記頁送出後回到 next（原票券連結） */
  | { status: 'verification_required'; kind: 'phone' | 'email'; registrationUrl: string }
  /** 連結不存在或過期（不透露任何租戶或聯絡人資料） */
  | { status: 'expired' }
  /** 租戶沒有啟用任何登記方式，無法驗證 */
  | { status: 'unavailable' }
  /** 這個渠道身分一小時內取得登記連結的次數已滿 */
  | { status: 'rate_limited' };

/** 啟用的登記方式：手機優先（台灣顧客較常用），其次 email */
function registrationKindFor(settings: { phoneEnabled: boolean; emailEnabled: boolean }): RegistrationKind | null {
  if (settings.phoneEnabled) return PHONE_REGISTRATION;
  if (settings.emailEnabled) return EMAIL_REGISTRATION;
  return null;
}

export async function openWalletSession(
  prisma: PrismaClient,
  deps: WalletDeps,
  token: string,
): Promise<WalletSessionResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  const { tenantId } = payload;

  const state = await withTenant(prisma, tenantId, async (tx) => {
    // 收到連結後聯絡人可能被合併：依合併鏈找到保留方，券也已隨合併移過去
    const liveId = await resolveLiveContactId(tx, tenantId, payload.contactId);
    if (!liveId) return null;
    const contact = await tx.contact.findFirst({
      where: { id: liveId, tenantId },
      select: { identityVerifiedAt: true },
    });
    if (!contact) return null;
    const settings = contact.identityVerifiedAt ? null : await getIdentityBindingSettings(tx, tenantId);
    return { liveId, verified: contact.identityVerifiedAt != null, settings };
  });
  if (!state) return { status: 'expired' };

  if (state.verified) {
    // 對話發券的「已領取」：顧客第一次開啟這張券（design D14）
    await withTenant(prisma, tenantId, (tx) =>
      tx.couponInstance.updateMany({
        where: { id: payload.instanceId, tenantId, contactId: state.liveId, viewedAt: null },
        data: { viewedAt: new Date(nowOf(deps)) },
      }));
    return {
      status: 'ok',
      fanToken: signFanToken(state.liveId, tenantId),
      tenantId,
      contactId: state.liveId,
      instanceId: payload.instanceId,
    };
  }

  const kind = state.settings ? registrationKindFor(state.settings) : null;
  if (!kind) return { status: 'unavailable' };
  const issued = await issueRegistrationToken(kind, { store: deps.store, now: deps.now }, payload);
  if (issued.status === 'rate_limited') return { status: 'rate_limited' };
  const next = `/coupon/open/${token}`;
  return {
    status: 'verification_required',
    kind: kind.name,
    registrationUrl: `/bind/${kind.pathSegment}/${issued.token}?next=${encodeURIComponent(next)}`,
  };
}

// ── 券夾 ──────────────────────────────────────────────────────────────────

export function listWallet(prisma: PrismaClient, fan: FanIdentity, now?: number) {
  return listFanCoupons(prisma, fan, now);
}

export function getWalletCoupon(prisma: PrismaClient, fan: FanIdentity, id: string, now?: number) {
  return getFanCoupon(prisma, fan, id, now);
}

// ── 店員驗證碼核銷時段 ─────────────────────────────────────────────────────

/** 按下「立即使用」後的核銷時段長度 */
export const REDEEM_SESSION_MS = 5 * 60 * 1000;
/** 一個時段內最多可輸入錯誤的次數 */
export const MAX_CODE_ATTEMPTS = 5;
/**
 * 同一張券 24 小時內最多可輸入錯誤的次數（跨時段累計）。驗證碼是整張券共用的，
 * 只限制單一時段的話，重新開始就能無限試下去，試出來後所有持有者都能自行核銷。
 */
export const MAX_DAILY_CODE_ATTEMPTS = 10;
const DAILY_ATTEMPTS_MS = 24 * 60 * 60 * 1000;
/**
 * Redis 保存時段的時間比時段本身長：時段結束後短時間內送出驗證碼，
 * 才能回報「核銷時間已結束」而不是「須先開始使用」。
 */
const SESSION_KEEP_MS = REDEEM_SESSION_MS * 2;

const sessionKey = (instanceId: string) => `coupon:redeem-session:${instanceId}`;
const attemptsKey = (instanceId: string) => `coupon:redeem-session:${instanceId}:attempts`;
const dailyAttemptsKey = (instanceId: string) => `coupon:redeem-code-attempts:${instanceId}`;

/** 24 小時內已用掉的驗證碼嘗試次數 */
async function dailyAttempts(store: BindingStore, instanceId: string): Promise<number> {
  return Number((await store.get(dailyAttemptsKey(instanceId))) ?? 0);
}

/** 先佔一次嘗試再比對：同時送出多個請求也都會被計入 */
async function takeAttempt(store: BindingStore, key: string, ttlMs: number): Promise<number> {
  const n = await store.incr(key);
  if (n === 1) await store.pexpire(key, ttlMs);
  return n;
}

type StartFailure =
  | 'NOT_FOUND' | 'NOT_STAFF_CODE' | 'ALREADY_REDEEMED' | 'EXPIRED' | 'REVOKED' | 'NOT_YET_VALID' | 'TOO_MANY_ATTEMPTS';

const UNAVAILABLE_REASON: Record<string, StartFailure> = {
  USED: 'ALREADY_REDEEMED',
  EXPIRED: 'EXPIRED',
  ENDED: 'REVOKED',
  NOT_YET: 'NOT_YET_VALID',
};

/**
 * 開始使用（店員驗證碼券）：開啟 5 分鐘的核銷時段。已有進行中的時段時沿用，不重新計時——
 * 否則顧客重整頁面就能無限延長時段。時段結束或錯誤達上限後才開新時段。
 */
export async function startStaffCodeSession(
  prisma: PrismaClient,
  deps: WalletDeps,
  fan: FanIdentity,
  instanceId: string,
): Promise<{ ok: true; expiresAt: Date; remainingMs: number } | { ok: false; reason: StartFailure }> {
  const now = nowOf(deps);
  const view = await getFanCoupon(prisma, fan, instanceId, now);
  if (!view) return { ok: false, reason: 'NOT_FOUND' };
  if (view.coupon.redeemMode !== 'STAFF_CODE') return { ok: false, reason: 'NOT_STAFF_CODE' };
  const unavailable = UNAVAILABLE_REASON[view.walletStatus];
  if (unavailable) return { ok: false, reason: unavailable };
  if ((await dailyAttempts(deps.store, instanceId)) >= MAX_DAILY_CODE_ATTEMPTS) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }

  const current = await readSession(deps.store, instanceId);
  if (current && current.expiresAt > now) {
    return { ok: true, expiresAt: new Date(current.expiresAt), remainingMs: current.expiresAt - now };
  }

  await deps.store.getdel(sessionKey(instanceId));
  await deps.store.getdel(attemptsKey(instanceId));
  const expiresAt = now + REDEEM_SESSION_MS;
  await deps.store.set(sessionKey(instanceId), JSON.stringify({ expiresAt }), 'PX', SESSION_KEEP_MS, 'NX');
  // remainingMs 以伺服器時間計算：顧客手機時鐘不準時，前端以「收到回應的時間＋剩餘毫秒」倒數
  return { ok: true, expiresAt: new Date(expiresAt), remainingMs: REDEEM_SESSION_MS };
}

async function readSession(store: BindingStore, instanceId: string): Promise<{ expiresAt: number } | null> {
  const raw = await store.get(sessionKey(instanceId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { expiresAt: number };
    return Number.isFinite(parsed.expiresAt) ? parsed : null;
  } catch {
    return null;
  }
}

async function closeSession(store: BindingStore, instanceId: string): Promise<void> {
  await store.getdel(sessionKey(instanceId));
  await store.getdel(attemptsKey(instanceId));
}

export type StaffCodeRedeemResult =
  | { ok: true; redeemedAt: Date; couponName: string }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'SESSION_REQUIRED' | 'SESSION_EXPIRED' | 'TOO_MANY_ATTEMPTS' | RedeemFailure;
      /** 驗證碼錯誤時剩餘可輸入次數；0＝時段已關閉，須重新開始 */
      attemptsLeft?: number;
      redeemedAt?: Date;
    };

/** 顧客手機上由店員輸入驗證碼核銷。錯誤時不透露正確的碼。 */
export async function redeemWithStaffCode(
  prisma: PrismaClient,
  deps: WalletDeps,
  fan: FanIdentity,
  instanceId: string,
  code: string,
): Promise<StaffCodeRedeemResult> {
  const now = nowOf(deps);
  const view = await getFanCoupon(prisma, fan, instanceId, now);
  if (!view) return { ok: false, reason: 'NOT_FOUND' };

  if ((await dailyAttempts(deps.store, instanceId)) >= MAX_DAILY_CODE_ATTEMPTS) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  const session = await readSession(deps.store, instanceId);
  if (!session) return { ok: false, reason: 'SESSION_REQUIRED' };
  if (session.expiresAt <= now) {
    await closeSession(deps.store, instanceId);
    return { ok: false, reason: 'SESSION_EXPIRED' };
  }

  // 先佔用嘗試次數再比對驗證碼，同時送出的請求也逃不過上限
  const daily = await takeAttempt(deps.store, dailyAttemptsKey(instanceId), DAILY_ATTEMPTS_MS);
  if (daily > MAX_DAILY_CODE_ATTEMPTS) {
    await closeSession(deps.store, instanceId);
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  const attempts = await takeAttempt(deps.store, attemptsKey(instanceId), SESSION_KEEP_MS);
  if (attempts > MAX_CODE_ATTEMPTS) {
    // 這個時段的次數已用完（同時送出的請求），沒有比對驗證碼，須重新開始
    await closeSession(deps.store, instanceId);
    return { ok: false, reason: 'SESSION_REQUIRED' };
  }

  const result = await redeemCoupon(prisma, fan.tenantId, {
    instanceId,
    staffCode: code,
    redeemedBy: null,
    redeemChannel: 'fan_staff_code',
  });
  if (result.ok) {
    await closeSession(deps.store, instanceId);
    return { ok: true, redeemedAt: result.redeemedAt, couponName: result.couponName };
  }
  if (result.reason !== 'STAFF_CODE_MISMATCH') {
    return { ok: false, reason: result.reason, ...(result.redeemedAt ? { redeemedAt: result.redeemedAt } : {}) };
  }

  const attemptsLeft = Math.max(0, Math.min(MAX_CODE_ATTEMPTS - attempts, MAX_DAILY_CODE_ATTEMPTS - daily));
  if (attemptsLeft === 0) await closeSession(deps.store, instanceId);
  return { ok: false, reason: 'STAFF_CODE_MISMATCH', attemptsLeft };
}

// ── 店員掃碼券的 QR Code ───────────────────────────────────────────────────

/**
 * 店員掃碼券的 QR Code（內容為券號，與店員手動輸入的序號相同）。
 * 只在可使用時產生：已使用、已失效或未生效的券不回傳券號。
 */
export async function getWalletQrCode(
  prisma: PrismaClient,
  fan: FanIdentity,
  instanceId: string,
  now?: number,
): Promise<{ ok: true; dataUrl: string } | { ok: false; reason: 'NOT_FOUND' | 'NOT_STAFF_SCAN' | 'NOT_AVAILABLE' }> {
  const view = await getFanCoupon(prisma, fan, instanceId, now);
  if (!view) return { ok: false, reason: 'NOT_FOUND' };
  if (view.coupon.redeemMode !== 'STAFF_SCAN') return { ok: false, reason: 'NOT_STAFF_SCAN' };
  if (!view.code || (view.walletStatus !== 'AVAILABLE' && view.walletStatus !== 'EXPIRING')) {
    return { ok: false, reason: 'NOT_AVAILABLE' };
  }
  // QR 內容一律是這張券自己的券號：共用碼券顧客看到的是共用碼，但掃碼要分得出是哪一位顧客
  const own = await withTenant(prisma, fan.tenantId, (tx) =>
    tx.couponInstance.findFirst({ where: { id: instanceId, tenantId: fan.tenantId }, select: { code: true } }));
  if (!own) return { ok: false, reason: 'NOT_FOUND' };
  const dataUrl = await QRCode.toDataURL(own.code, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
  return { ok: true, dataUrl };
}
