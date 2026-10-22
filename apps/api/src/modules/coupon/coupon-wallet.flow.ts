/**
 * 顧客票券夾的入口（公開端點，沒有登入的座席）：租戶由票券權杖或顧客憑證決定，
 * 這裡以 inTenant() 開交易，再呼叫只收 TenantCtx 的 service（AGENTS.md 結構規則 2）。
 *
 * 路由與測試都經過這裡，所以交易邊界只有一份。Redis（登記連結、核銷時段）一律在交易外操作。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { readWalletToken } from '@open333crm/core';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import { createOutboxPublisher } from '../../events/outbox-publisher.js';
import type { FanIdentity } from './coupon-fan.service.js';
import { reuseOrIssueRegistrationToken } from '../identity-binding/identifier-registration.js';
import {
  getWalletCoupon,
  getWalletQrCode,
  lineLoginTarget,
  listWallet,
  markLineVerified,
  openWalletSession,
  redeemByStaffCode,
  staffCodeTarget,
  type LineLoginDeps,
  type LineLoginResult,
  type StaffCodeRedeemResult,
  type StaffCodeStartFailure,
  type WalletDeps,
  type WalletSessionResult,
} from './coupon-wallet.service.js';
import {
  DAILY_ATTEMPTS_MS,
  MAX_CODE_ATTEMPTS,
  MAX_DAILY_CODE_ATTEMPTS,
  REDEEM_SESSION_MS,
  SESSION_KEEP_MS,
  attemptsKey,
  closeSession,
  dailyAttempts,
  openSession,
  readSession,
  takeAttempt,
} from './coupon-staff-code-session.js';

export interface WalletFlowDeps extends WalletDeps {
  prisma: PrismaClient;
  /** 推播「已發優惠券」更新；沒有 io 時 service 推播會丟錯（寫錯程式要看得到） */
  io: Server;
}

function inTenantOf<T>(deps: WalletFlowDeps, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return inTenant({ prisma: deps.prisma, io: deps.io, events: createOutboxPublisher(deps.prisma) }, tenantId, fn);
}

/** 以顧客憑證的租戶開交易 */
export function inFanTenant<T>(deps: WalletFlowDeps, fan: FanIdentity, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return inTenantOf(deps, fan.tenantId, fn);
}

/** 票券連結換顧客憑證：權杖決定租戶，不信任網址參數 */
export async function openWalletSessionFlow(deps: WalletFlowDeps, token: string): Promise<WalletSessionResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  const step = await inTenantOf(deps, payload.tenantId, (ctx) => openWalletSession(ctx, deps, payload));
  if (step.status !== 'needs_registration') return step;

  // 未驗證身分：產生（或沿用）登記連結，登記頁送出後回到原票券連結
  const { kind, channelType } = step;
  const issued = await reuseOrIssueRegistrationToken(kind, { store: deps.store, now: deps.now }, payload);
  if (issued.status === 'rate_limited') return { status: 'rate_limited', channelType };
  const next = `/coupon/open/${token}`;
  return {
    status: 'verification_required',
    channelType,
    kind: kind.name,
    registrationUrl: `/bind/${kind.pathSegment}/${issued.token}?next=${encodeURIComponent(next)}`,
  };
}

/**
 * LINE 顧客以 LIFF 的 ID token 驗證（design D20）。三步：讀設定（交易）→ 向 LINE 驗證（外部呼叫，
 * 最多一次，不重試）→ 記錄驗證（交易）。向 LINE 驗證不放在交易內。
 */
export async function openWalletSessionWithLineFlow(
  deps: WalletFlowDeps & Pick<LineLoginDeps, 'verifyLineIdToken'>,
  token: string,
  idToken: string,
): Promise<LineLoginResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  const target = await inTenantOf(deps, payload.tenantId, (ctx) => lineLoginTarget(ctx, payload));
  if (!target) return { status: 'not_configured' };

  const verified = await deps.verifyLineIdToken(idToken, target.loginChannelId);
  if (!verified) return { status: 'verification_failed' };
  if (verified.sub !== target.uid) return { status: 'account_mismatch' };

  const marked = await inTenantOf(deps, payload.tenantId, (ctx) =>
    markLineVerified(ctx, payload, (deps.now ?? Date.now)()));
  return marked ? { status: 'verified' } : { status: 'expired' };
}

export function listWalletFlow(deps: WalletFlowDeps, fan: FanIdentity, now?: number) {
  return inFanTenant(deps, fan, (ctx) => listWallet(ctx, fan, now));
}

export function getWalletCouponFlow(deps: WalletFlowDeps, fan: FanIdentity, id: string, now?: number) {
  return inFanTenant(deps, fan, (ctx) => getWalletCoupon(ctx, fan, id, now));
}

/**
 * 開始使用（店員驗證碼券）：開啟 5 分鐘的核銷時段。已有進行中的時段時沿用，不重新計時——
 * 否則顧客重整頁面就能無限延長時段。時段結束或錯誤達上限後才開新時段。
 */
export async function startStaffCodeSessionFlow(
  deps: WalletFlowDeps,
  fan: FanIdentity,
  instanceId: string,
): Promise<{ ok: true; expiresAt: Date; remainingMs: number } | { ok: false; reason: StaffCodeStartFailure }> {
  const now = (deps.now ?? Date.now)();
  const target = await inFanTenant(deps, fan, (ctx) => staffCodeTarget(ctx, fan, instanceId, now, { checkUsable: true }));
  if (!target.ok) return target;
  if ((await dailyAttempts(deps.store, target.dailyKey)) >= MAX_DAILY_CODE_ATTEMPTS) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  const current = await readSession(deps.store, instanceId);
  if (current && current.expiresAt > now) {
    return { ok: true, expiresAt: new Date(current.expiresAt), remainingMs: current.expiresAt - now };
  }
  const expiresAt = await openSession(deps.store, instanceId, now);
  // remainingMs 以伺服器時間計算：顧客手機時鐘不準時，前端以「收到回應的時間＋剩餘毫秒」倒數
  return { ok: true, expiresAt: new Date(expiresAt), remainingMs: REDEEM_SESSION_MS };
}

/**
 * 顧客手機上由店員輸入驗證碼核銷。錯誤時不透露正確的碼。
 * 三步：確認券屬於顧客（交易）→ 檢查時段並先佔用嘗試次數（Redis）→ 核銷（交易）；commit 後才關閉時段。
 */
export async function redeemWithStaffCodeFlow(
  deps: WalletFlowDeps,
  fan: FanIdentity,
  instanceId: string,
  code: string,
): Promise<StaffCodeRedeemResult> {
  const now = (deps.now ?? Date.now)();
  const target = await inFanTenant(deps, fan, (ctx) => staffCodeTarget(ctx, fan, instanceId, now, { checkUsable: false }));
  if (!target.ok) return { ok: false, reason: 'NOT_FOUND' };
  const { dailyKey } = target;

  if ((await dailyAttempts(deps.store, dailyKey)) >= MAX_DAILY_CODE_ATTEMPTS) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  }
  const session = await readSession(deps.store, instanceId);
  if (!session) return { ok: false, reason: 'SESSION_REQUIRED' };
  if (session.expiresAt <= now) {
    await closeSession(deps.store, instanceId);
    return { ok: false, reason: 'SESSION_EXPIRED' };
  }

  // 先佔用嘗試次數再比對驗證碼，同時送出的請求也逃不過上限
  const daily = await takeAttempt(deps.store, dailyKey, DAILY_ATTEMPTS_MS);
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

  const result = await inFanTenant(deps, fan, (ctx) => redeemByStaffCode(ctx, instanceId, code));
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

export function getWalletQrCodeFlow(deps: WalletFlowDeps, fan: FanIdentity, instanceId: string, now?: number) {
  return inFanTenant(deps, fan, (ctx) => getWalletQrCode(ctx, fan, instanceId, now));
}
