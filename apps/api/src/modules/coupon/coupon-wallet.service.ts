/**
 * 顧客票券夾（add-coupon-system A9、design D12）：
 * - 票券連結換顧客憑證：已歸戶才發憑證，未歸戶回傳 One ID 登記頁網址
 * - 店員驗證碼核銷時段：5 分鐘內、最多錯 5 次
 *
 * 票券連結與核銷時段存在 Redis（coupon-staff-code-session.ts），測試注入記憶體版本。
 * 交易由入口開（coupon-wallet.flow.ts）：票券權杖決定租戶，service 只收 TenantCtx。
 * Redis 操作不在交易內，由 flow 在交易前後執行。
 */
import QRCode from 'qrcode';
import { couponLiffConfig, type WalletToken } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { signFanToken } from '../portal/portal-auth.service.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { resolveLiveContactId } from '../identity-binding/binding-common.js';
import { getIdentityBindingSettings } from '../identity-binding/identity-binding.service.js';
import type { RegistrationKind } from '../identity-binding/identifier-registration.js';
import { EMAIL_REGISTRATION } from '../identity-binding/email-registration.service.js';
import { getFanCoupon, isOwnedByFan, listFanCoupons, type FanIdentity } from './coupon-fan.service.js';
import { redeemCoupon, type RedeemFailure } from './coupon-redeem.service.js';

export interface WalletDeps {
  store: BindingStore;
  now?: () => number;
}

const nowOf = (deps: Pick<WalletDeps, 'now'>) => (deps.now ?? Date.now)();

// ── 票券連結換顧客憑證 ─────────────────────────────────────────────────────

/** 連結所屬的渠道類型：票券頁依此顯示「回到 LINE」「回到 Messenger」等文字 */
type WithChannel<T> = T & { channelType: string | null };

export type WalletSessionResult =
  | WithChannel<{ status: 'ok'; fanToken: string; tenantId: string; contactId: string; instanceId: string }>
  /** 未歸戶：帶顧客去登記，登記頁送出後回到 next（原票券連結） */
  | WithChannel<{ status: 'verification_required'; kind: 'phone' | 'email'; registrationUrl: string }>
  /** 連結不存在或過期（不透露任何租戶或聯絡人資料） */
  | { status: 'expired' }
  /** 租戶沒有啟用任何登記方式，無法驗證 */
  | WithChannel<{ status: 'unavailable' }>
  /** 這個渠道身分一小時內取得登記連結的次數已滿 */
  | WithChannel<{ status: 'rate_limited' }>;

/**
 * 票券夾的歸戶驗證只接受 email（寄驗證碼，design D15）或 LINE Login（D20）。
 * 手機登記沒有簡訊驗證、不算驗證，租戶只啟用手機時無法驗證（2026-10-21 code review 決定）
 */
function registrationKindFor(settings: { phoneEnabled: boolean; emailEnabled: boolean }): RegistrationKind | null {
  if (settings.emailEnabled) return EMAIL_REGISTRATION;
  return null;
}

/** 未驗證身分、要帶顧客去登記：登記連結（Redis）由 flow 在交易外產生 */
export type WalletOpenStep =
  | Exclude<WalletSessionResult, { status: 'verification_required' } | { status: 'rate_limited' }>
  | { status: 'needs_registration'; kind: RegistrationKind; channelType: string | null };

/**
 * 票券連結換顧客憑證（交易內的部分）。payload 由入口先以票券權杖讀出（決定租戶），ctx 綁定 payload.tenantId。
 */
export async function openWalletSession(
  ctx: TenantCtx,
  deps: Pick<WalletDeps, 'now'>,
  payload: WalletToken,
): Promise<WalletOpenStep> {
  const { tx, tenantId } = ctx;
  // 點擊歸因（design D21）：不論是否已驗證身分，每次開啟都記錄
  const openedAt = new Date(nowOf(deps));
  await tx.couponInstance.updateMany({
    where: { id: payload.instanceId, tenantId },
    data: { linkOpenCount: { increment: 1 } },
  });
  await tx.couponInstance.updateMany({
    where: { id: payload.instanceId, tenantId, linkOpenedAt: null },
    data: { linkOpenedAt: openedAt },
  });
  // 收到連結後聯絡人可能被合併：依合併鏈找到保留方，券也已隨合併移過去
  const liveId = await resolveLiveContactId(tx, tenantId, payload.contactId);
  if (!liveId) return { status: 'expired' };
  const contact = await tx.contact.findFirst({
    where: { id: liveId, tenantId },
    select: { identityVerifiedAt: true },
  });
  if (!contact) return { status: 'expired' };
  const channel = await tx.channel.findFirst({ where: { id: payload.channelId, tenantId }, select: { channelType: true } });
  const channelType = channel?.channelType ?? null;

  if (contact.identityVerifiedAt) {
    // 對話發券的「已領取」：顧客第一次開啟這張券（design D14）
    await tx.couponInstance.updateMany({
      where: { id: payload.instanceId, tenantId, contactId: liveId, viewedAt: null },
      data: { viewedAt: new Date(nowOf(deps)) },
    });
    // 收件匣「已發優惠券」重新載入（design D23）
    ctx.notify('coupon.instance.updated', { instanceId: payload.instanceId, contactId: liveId, change: 'viewed' });
    return {
      status: 'ok',
      fanToken: signFanToken(liveId, tenantId),
      tenantId,
      contactId: liveId,
      instanceId: payload.instanceId,
      channelType,
    };
  }

  const kind = registrationKindFor(await getIdentityBindingSettings(tx, tenantId));
  if (!kind) return { status: 'unavailable', channelType };
  return { status: 'needs_registration', kind, channelType };
}

// ── 券夾 ──────────────────────────────────────────────────────────────────

export function listWallet(ctx: TenantCtx, fan: FanIdentity, now?: number) {
  return listFanCoupons(ctx, fan, now);
}

export function getWalletCoupon(ctx: TenantCtx, fan: FanIdentity, id: string, now?: number) {
  return getFanCoupon(ctx, fan, id, now);
}

// ── 店員驗證碼核銷（交易內的部分；核銷時段在 Redis，由 flow 處理）──────────

export type StaffCodeStartFailure =
  | 'NOT_FOUND' | 'NOT_STAFF_CODE' | 'ALREADY_REDEEMED' | 'EXPIRED' | 'REVOKED' | 'NOT_YET_VALID' | 'TOO_MANY_ATTEMPTS';

const UNAVAILABLE_REASON: Record<string, StaffCodeStartFailure> = {
  USED: 'ALREADY_REDEEMED',
  EXPIRED: 'EXPIRED',
  ENDED: 'REVOKED',
  NOT_YET: 'NOT_YET_VALID',
};

/**
 * 店員驗證碼券的核銷前檢查：券屬於這位顧客、是店員驗證碼券、目前可用。
 * 回傳 24 小時錯誤次數的計數鍵：以「同一位顧客 × 同一張券（活動）」累計——
 * 驗證碼是整張券共用的，以單張券計算的話，持有多張就能多試幾倍。
 * checkUsable 為 false 時（送出驗證碼）只確認券屬於顧客，可用與否交給 redeemCoupon 判斷。
 */
export async function staffCodeTarget(
  ctx: TenantCtx,
  fan: FanIdentity,
  instanceId: string,
  now: number,
  opts: { checkUsable: boolean },
): Promise<{ ok: true; dailyKey: string } | { ok: false; reason: StaffCodeStartFailure }> {
  const view = await getFanCoupon(ctx, fan, instanceId, now);
  if (!view) return { ok: false, reason: 'NOT_FOUND' };
  if (opts.checkUsable) {
    if (view.coupon.redeemMode !== 'STAFF_CODE') return { ok: false, reason: 'NOT_STAFF_CODE' };
    const unavailable = UNAVAILABLE_REASON[view.walletStatus];
    if (unavailable) return { ok: false, reason: unavailable };
  }
  const row = await ctx.tx.couponInstance.findFirst({
    where: { id: instanceId, tenantId: ctx.tenantId },
    select: { couponId: true },
  });
  return { ok: true, dailyKey: `coupon:redeem-code-attempts:${ctx.tenantId}:${row?.couponId ?? instanceId}:${fan.contactId}` };
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

/** 以店員輸入的驗證碼核銷（時段與次數已由 flow 在交易外佔用） */
export function redeemByStaffCode(ctx: TenantCtx, instanceId: string, code: string) {
  return redeemCoupon(ctx, { instanceId, staffCode: code, redeemedBy: null, redeemChannel: 'fan_staff_code' });
}

// ── 顧客自助核銷 ───────────────────────────────────────────────────────────

/**
 * 顧客自助核銷。先確認這張券屬於請求者（避免以他人 instanceId 觸發核銷），
 * 非自助券由 redeemCoupon 擋下（SELF_REDEEM_NOT_ALLOWED）。
 */
export async function redeemSelf(
  ctx: TenantCtx,
  fan: FanIdentity,
  instanceId: string,
): Promise<{ ok: true; redeemedAt: Date; couponName: string } | { ok: false; reason: 'NOT_FOUND' | RedeemFailure }> {
  if (!(await isOwnedByFan(ctx, fan, instanceId))) return { ok: false, reason: 'NOT_FOUND' };
  const result = await redeemCoupon(ctx, { instanceId, selfService: true, redeemedBy: null, redeemChannel: 'fan_self' });
  return result.ok ? { ok: true, redeemedAt: result.redeemedAt, couponName: result.couponName } : { ok: false, reason: result.reason };
}

// ── 店員掃碼券的 QR Code ───────────────────────────────────────────────────

/**
 * 店員掃碼券的 QR Code（內容為券號，與店員手動輸入的序號相同）。
 * 只在可使用時產生：已使用、已失效或未生效的券不回傳券號。
 */
export async function getWalletQrCode(
  ctx: TenantCtx,
  fan: FanIdentity,
  instanceId: string,
  now?: number,
): Promise<{ ok: true; dataUrl: string } | { ok: false; reason: 'NOT_FOUND' | 'NOT_STAFF_SCAN' | 'NOT_AVAILABLE' }> {
  const view = await getFanCoupon(ctx, fan, instanceId, now);
  if (!view) return { ok: false, reason: 'NOT_FOUND' };
  if (view.coupon.redeemMode !== 'STAFF_SCAN') return { ok: false, reason: 'NOT_STAFF_SCAN' };
  if (!view.code || (view.walletStatus !== 'AVAILABLE' && view.walletStatus !== 'EXPIRING')) {
    return { ok: false, reason: 'NOT_AVAILABLE' };
  }
  // 開啟後計時的券要先開啟（效期從開啟起算）
  if (view.coupon.validityMode === 'AFTER_OPEN' && !view.openedAt) return { ok: false, reason: 'NOT_AVAILABLE' };
  // QR 內容一律是這張券自己的券號：共用碼券顧客看到的是共用碼，但掃碼要分得出是哪一位顧客
  const own = await ctx.tx.couponInstance.findFirst({
    where: { id: instanceId, tenantId: ctx.tenantId },
    select: { code: true },
  });
  if (!own) return { ok: false, reason: 'NOT_FOUND' };
  const dataUrl = await QRCode.toDataURL(own.code, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
  return { ok: true, dataUrl };
}

// ── LINE Login 驗證（design D20） ─────────────────────────────────────────

export interface LineLoginDeps extends WalletDeps {
  /** 向 LINE 驗證 ID token；clientId 為 Login Channel ID。驗證不通過回 null */
  verifyLineIdToken: (idToken: string, clientId: string) => Promise<{ sub: string } | null>;
}

export type LineLoginResult =
  /** 已記錄歸戶驗證，接著照一般流程開啟票券 */
  | { status: 'verified' }
  | { status: 'expired' }
  /** 渠道沒有設定 LIFF 與 Login Channel ID，改走 One ID 登記 */
  | { status: 'not_configured' }
  | { status: 'verification_failed' }
  /** ID token 的 LINE 帳號不是收到這張券的帳號（連結被轉傳） */
  | { status: 'account_mismatch' };

/**
 * LINE 驗證的對象（design D20 第 1 步）：渠道的 LIFF 設定與收券的 LINE userId。
 * 驗證分三步，由入口執行：讀設定（交易）→ 向 LINE 驗證 ID token（外部呼叫，最多一次）→ 記錄驗證（交易）。
 */
export async function lineLoginTarget(
  ctx: TenantCtx,
  payload: WalletToken,
): Promise<{ loginChannelId: string; uid: string } | null> {
  const { tx, tenantId } = ctx;
  const channel = await tx.channel.findFirst({ where: { id: payload.channelId, tenantId }, select: { settings: true } });
  const identity = await tx.channelIdentity.findFirst({
    where: { id: payload.channelIdentityId, contact: { tenantId } },
    select: { uid: true },
  });
  const liff = couponLiffConfig(channel?.settings);
  return liff && identity ? { loginChannelId: liff.loginChannelId, uid: identity.uid } : null;
}

/** 第 3 步：記錄歸戶驗證（方式 line）。聯絡人已合併時記在保留方；找不到聯絡人回 false */
export async function markLineVerified(ctx: TenantCtx, payload: WalletToken, now: number): Promise<boolean> {
  const { tx, tenantId } = ctx;
  const liveId = await resolveLiveContactId(tx, tenantId, payload.contactId);
  if (!liveId) return false;
  await tx.contact.updateMany({
    where: { id: liveId, tenantId, identityVerifiedAt: null },
    data: { identityVerifiedAt: new Date(now), identityVerifiedVia: 'line' },
  });
  return true;
}
