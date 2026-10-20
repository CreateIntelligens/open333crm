/**
 * 顧客票券夾（add-coupon-system A9、design D12）：
 * - 對話發券：發券、產生票券連結、送出訊息
 * - 票券連結換顧客憑證：已歸戶才發憑證，未歸戶回傳 One ID 登記頁網址
 * - 店員驗證碼核銷時段：5 分鐘內、最多錯 5 次
 *
 * 票券連結與核銷時段存在 Redis（deps.store），測試注入記憶體版本。
 */
import type { PrismaClient } from '@prisma/client';
import {
  buildCouponMessage,
  issueWalletToken,
  readWalletToken,
  walletLinkUrl,
  type WalletTokenPayload,
} from '@open333crm/core';
import { getConfig } from '../../config/env.js';
import { withTenant } from '../../lib/tenant-db.js';
import { signFanToken } from '../portal/portal-auth.service.js';
import type { BindingStore } from '../identity-binding/binding-code.js';
import { resolveLiveContactId } from '../identity-binding/binding-common.js';
import { getIdentityBindingSettings } from '../identity-binding/identity-binding.service.js';
import { issueRegistrationToken, type RegistrationKind } from '../identity-binding/identifier-registration.js';
import { PHONE_REGISTRATION } from '../identity-binding/phone-registration.service.js';
import { EMAIL_REGISTRATION } from '../identity-binding/email-registration.service.js';
import { issueCoupons } from './coupon-issue.service.js';
import { sendCouponText } from './coupon-delivery.service.js';
import { getFanCoupon, listFanCoupons, type FanIdentity } from './coupon-fan.service.js';
import { redeemCoupon, type RedeemFailure } from './coupon-redeem.service.js';

export interface WalletDeps {
  store: BindingStore;
  now?: () => number;
  /** 票券連結的網址前綴；預設為 WEB_BASE_URL */
  webBaseUrl?: string;
  /** 送出發券訊息；預設走 sendCouponText（測試可替換） */
  deliver?: (
    prisma: PrismaClient,
    params: { tenantId: string; conversationId: string; text: string },
  ) => Promise<{ sent: boolean; reason?: string }>;
}

const nowOf = (deps: WalletDeps) => (deps.now ?? Date.now)();

// ── 對話發券 ──────────────────────────────────────────────────────────────

export type IssueToConversationResult =
  | { ok: true; instanceId: string; code: string; messageSent: boolean; deliveryError?: string }
  | { ok: false; reason: string };

/**
 * 在對話中發券並送出帶票券連結的訊息（B1）。對象一律是對話的聯絡人，不接受請求指定 contactId。
 * 對話對象已知，所有渠道都直接歸戶為已領取（design D12）；顧客開啟連結時再做歸戶驗證。
 */
export async function issueToConversation(
  prisma: PrismaClient,
  deps: WalletDeps,
  input: { tenantId: string; couponId: string; conversationId: string; agentId: string; agentName?: string },
): Promise<IssueToConversationResult> {
  const { tenantId } = input;
  const target = await withTenant(prisma, tenantId, async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: input.conversationId, tenantId },
      select: { id: true, contactId: true, channelId: true },
    });
    if (!conversation?.contactId) return null;
    const identity = await tx.channelIdentity.findFirst({
      where: { contactId: conversation.contactId, channelId: conversation.channelId },
      select: { id: true },
    });
    const coupon = await tx.coupon.findFirst({ where: { id: input.couponId, tenantId }, select: { name: true } });
    return identity && coupon ? { conversation, identityId: identity.id, couponName: coupon.name } : null;
  });
  if (!target) return { ok: false, reason: 'NOT_FOUND' };
  const contactId = target.conversation.contactId as string;

  const result = await issueCoupons(prisma, tenantId, input.couponId, {
    contactIds: [contactId],
    issuedVia: 'inbox',
    issuedRefId: input.agentId,
    issuedByName: input.agentName,
    requireClaim: false,
  });
  const instance = result.issued[0];
  if (!instance) return { ok: false, reason: result.skipped[0]?.reason ?? 'UNKNOWN' };

  const payload: WalletTokenPayload = {
    tenantId,
    contactId,
    channelIdentityId: target.identityId,
    channelId: target.conversation.channelId,
    conversationId: target.conversation.id,
    instanceId: instance.id,
  };
  const token = await issueWalletToken(deps.store, payload, deps.now);
  const text = buildCouponMessage({
    couponName: target.couponName,
    url: walletLinkUrl(deps.webBaseUrl ?? getConfig().WEB_BASE_URL, token),
  });
  const deliver = deps.deliver ?? sendCouponText;
  const delivery = await deliver(prisma, { tenantId, conversationId: target.conversation.id, text });
  return {
    ok: true,
    instanceId: instance.id,
    code: instance.code,
    messageSent: delivery.sent,
    ...(delivery.sent ? {} : { deliveryError: delivery.reason }),
  };
}

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
 * Redis 保存時段的時間比時段本身長：時段結束後短時間內送出驗證碼，
 * 才能回報「核銷時間已結束」而不是「須先開始使用」。
 */
const SESSION_KEEP_MS = REDEEM_SESSION_MS * 2;

const sessionKey = (instanceId: string) => `coupon:redeem-session:${instanceId}`;
const attemptsKey = (instanceId: string) => `coupon:redeem-session:${instanceId}:attempts`;

type StartFailure = 'NOT_FOUND' | 'NOT_STAFF_CODE' | 'ALREADY_REDEEMED' | 'EXPIRED' | 'REVOKED' | 'NOT_YET_VALID';

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
): Promise<{ ok: true; expiresAt: Date } | { ok: false; reason: StartFailure }> {
  const now = nowOf(deps);
  const view = await getFanCoupon(prisma, fan, instanceId, now);
  if (!view) return { ok: false, reason: 'NOT_FOUND' };
  if (view.coupon.redeemMode !== 'STAFF_CODE') return { ok: false, reason: 'NOT_STAFF_CODE' };
  const unavailable = UNAVAILABLE_REASON[view.walletStatus];
  if (unavailable) return { ok: false, reason: unavailable };

  const current = await readSession(deps.store, instanceId);
  if (current && current.expiresAt > now) return { ok: true, expiresAt: new Date(current.expiresAt) };

  await deps.store.getdel(sessionKey(instanceId));
  await deps.store.getdel(attemptsKey(instanceId));
  const expiresAt = now + REDEEM_SESSION_MS;
  await deps.store.set(sessionKey(instanceId), JSON.stringify({ expiresAt }), 'PX', SESSION_KEEP_MS, 'NX');
  return { ok: true, expiresAt: new Date(expiresAt) };
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
      reason: 'NOT_FOUND' | 'SESSION_REQUIRED' | 'SESSION_EXPIRED' | RedeemFailure;
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

  const session = await readSession(deps.store, instanceId);
  if (!session) return { ok: false, reason: 'SESSION_REQUIRED' };
  if (session.expiresAt <= now) {
    await closeSession(deps.store, instanceId);
    return { ok: false, reason: 'SESSION_EXPIRED' };
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

  const attempts = await deps.store.incr(attemptsKey(instanceId));
  if (attempts === 1) await deps.store.pexpire(attemptsKey(instanceId), SESSION_KEEP_MS);
  const attemptsLeft = Math.max(0, MAX_CODE_ATTEMPTS - attempts);
  if (attemptsLeft === 0) await closeSession(deps.store, instanceId);
  return { ok: false, reason: 'STAFF_CODE_MISMATCH', attemptsLeft };
}
