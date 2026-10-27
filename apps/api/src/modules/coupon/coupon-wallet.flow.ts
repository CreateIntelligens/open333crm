/**
 * 顧客票券夾的入口（公開端點，沒有登入的座席）：租戶由票券權杖或顧客憑證決定，
 * 這裡以 inTenant() 開交易，再呼叫只收 TenantCtx 的 service（AGENTS.md 結構規則 2）。
 *
 * 路由與測試都經過這裡，所以交易邊界只有一份。Redis（登記連結、核銷時段）一律在交易外操作。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { readWalletToken } from '@open333crm/core';
import { inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import { notifyInstanceUpdated } from './coupon-effects.js';
import type { FanIdentity } from './coupon-fan.service.js';
import { reuseOrIssueRegistrationToken } from '../identity-binding/identifier-registration.js';
import {
  checkVerificationCode, consumeVerificationCode, restoreVerificationCode,
  clearVerificationCode,
  sendVerificationCode,
  type VerificationCodeKeys,
} from '../identity-binding/ownership-code.js';
import { verificationEmailSender } from '../identity-binding/ownership-code-email.js';
import { signFanDeviceToken } from '../portal/portal-auth.service.js';
import {
  completeWalletEmailCode,
  getWalletCoupon,
  getWalletQrCode,
  lineLoginTarget,
  listWallet,
  markLineVerified,
  openWalletSession,
  redeemByStaffCode,
  redeemSelf,
  staffCodeTarget,
  walletEmailCodeTarget,
  type LineLoginDeps,
  type LineLoginResult,
  type StaffCodeRedeemResult,
  type StaffCodeStartFailure,
  type WalletDeps,
  type WalletSessionOk,
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
  /** 推播「已發優惠券」更新 */
  io: Server;
  /** 寄出開啟票券的 email 驗證碼（design D24）；測試注入，預設以租戶名稱署名寄出。失敗時拋錯 */
  sendEmailCode?: (to: string, code: string, senderName: string) => Promise<void>;
}

function inTenantOf<T>(deps: WalletFlowDeps, tenantId: string, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return inTenant(deps.prisma, tenantId, fn);
}

/** 以顧客憑證的租戶開交易 */
export function inFanTenant<T>(deps: WalletFlowDeps, fan: FanIdentity, fn: (scope: TenantScope) => Promise<T>): Promise<T> {
  return inTenantOf(deps, fan.tenantId, fn);
}

/** 顧客開啟票券：收件匣「已發優惠券」重新載入（design D23） */
function notifyViewed<T extends { status: string }>(scope: TenantScope, deps: WalletFlowDeps, result: T): T {
  if (isOpened(result)) {
    notifyInstanceUpdated(scope, deps.io, { instanceId: result.instanceId, contactId: result.contactId, change: 'viewed' });
  }
  return result;
}

const isOpened = (result: { status: string }): result is WalletSessionOk => result.status === 'ok';

/**
 * 票券連結換顧客憑證：權杖決定租戶，不信任網址參數。
 * deviceTokens 是這台裝置存的裝置憑證：已歸戶的顧客要在驗證過的裝置開啟（design D24）
 */
export async function openWalletSessionFlow(
  deps: WalletFlowDeps,
  token: string,
  deviceTokens: readonly string[] = [],
): Promise<WalletSessionResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  const step = await inTenantOf(deps, payload.tenantId, async (scope) =>
    notifyViewed(scope, deps, await openWalletSession(scope, deps, payload, deviceTokens)));
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

  const liveId = await inTenantOf(deps, payload.tenantId, (ctx) =>
    markLineVerified(ctx, payload, (deps.now ?? Date.now)()));
  // 這台裝置以收券的 LINE 帳號驗證過：記住裝置，之後照一般流程呼叫 /session 帶上它（design D24）
  return liveId ? { status: 'verified', deviceToken: signFanDeviceToken(liveId, payload.tenantId) } : { status: 'expired' };
}

// ── 以原 email 驗證碼確認身分（design D24）────────────────────────────────

/** 同一個票券連結寄驗證碼次數的計算期間（10 分鐘內最多 3 次，與 email 登記共用 MAX_CODES_PER_LINK） */
export const WALLET_CODE_SEND_WINDOW_MS = 10 * 60 * 1000;

/** 驗證碼以票券連結為單位：權杖本身是伺服器發的隨機值，同時當雜湊的鹽 */
const walletCodeKeys = (token: string): VerificationCodeKeys => ({
  code: `coupon:wallet-code:${token}`,
  attempt: `coupon:wallet-code-attempt:${token}`,
  send: `coupon:wallet-code-send:${token}`,
  sendLock: `coupon:wallet-code-lock:${token}`,
  salt: token,
  sendWindowMs: WALLET_CODE_SEND_WINDOW_MS,
});

export type WalletEmailCodeRequestResult =
  | { status: 'code_sent'; maskedEmail: string }
  | { status: 'expired' }
  /** 聯絡人未歸戶或沒有 email：不寄信 */
  | { status: 'unavailable' }
  | { status: 'too_many_codes' }
  | { status: 'in_progress' }
  | { status: 'send_failed' };

/**
 * 寄 6 位數驗證碼到票券連結聯絡人原本的 email。三步：找對象（交易）→ 寄信（外部呼叫，最多一次，
 * 寄信失敗不計次數）→ 驗證碼存 Redis。寄信不放在交易內。
 */
export async function requestWalletEmailCodeFlow(deps: WalletFlowDeps, token: string): Promise<WalletEmailCodeRequestResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  const target = await inTenantOf(deps, payload.tenantId, (ctx) => walletEmailCodeTarget(ctx, payload));
  if (!target) return { status: 'unavailable' };

  const send = deps.sendEmailCode
    ? (to: string, code: string) => deps.sendEmailCode!(to, code, target.senderName)
    : verificationEmailSender(target.senderName, 'coupon');
  const sent = await sendVerificationCode(deps.store, walletCodeKeys(token), target.email, target.contactId, send);
  return sent.status === 'code_sent' ? { status: 'code_sent', maskedEmail: target.maskedEmail } : sent;
}

export type WalletEmailCodeVerifyResult =
  | WalletSessionOk
  | { status: 'expired' }
  | { status: 'code_expired' }
  | { status: 'locked' }
  | { status: 'invalid_code'; remainingAttempts: number };

/**
 * 檢查驗證碼（Redis，先計次再以固定時間比對）→ 正確則開啟票券（交易），commit 後清除驗證碼。
 * 同一組驗證碼最多錯 5 次，錯滿作廢需重寄。
 */
export async function verifyWalletEmailCodeFlow(
  deps: WalletFlowDeps,
  token: string,
  code: unknown,
): Promise<WalletEmailCodeVerifyResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  const keys = walletCodeKeys(token);
  const checked = await checkVerificationCode(deps.store, keys, code);
  if (checked.status !== 'ok') return checked;
  // 驗證碼只能用一次：並行送出同一組碼時，只有先取走的請求繼續
  const consumed = await consumeVerificationCode(deps.store, keys, checked.claim);
  if (!consumed.ok) return { status: 'code_expired' };

  let result: Awaited<ReturnType<typeof completeWalletEmailCode>>;
  try {
    result = await inTenantOf(deps, payload.tenantId, async (scope) =>
      notifyViewed(scope, deps, await completeWalletEmailCode(scope, deps, payload, checked.value)));
  } catch (err) {
    // 開啟失敗（例如資料庫暫時無法連線）：放回驗證碼，顧客可用同一組再試
    await restoreVerificationCode(deps.store, keys, checked.claim, consumed.ttlMs);
    throw err;
  }
  // 驗證碼只能用一次；寄送次數保留，避免以同一個連結反覆寄信
  await clearVerificationCode(deps.store, keys, false);
  return result;
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

  const result = await inFanTenant(deps, fan, async (scope) => {
    const redeemed = await redeemByStaffCode(scope, instanceId, code);
    if (redeemed.ok) notifyInstanceUpdated(scope, deps.io, { instanceId: redeemed.instanceId, contactId: redeemed.contactId, change: 'redeemed' });
    return redeemed;
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

/** 顧客自助核銷（只限自助券，service 擋下其他核銷方式）；成功時 commit 後推播券狀態更新 */
export async function redeemSelfFlow(deps: WalletFlowDeps, fan: FanIdentity, instanceId: string) {
  const result = await inFanTenant(deps, fan, async (scope) => {
    const redeemed = await redeemSelf(scope, fan, instanceId);
    if (redeemed.ok) notifyInstanceUpdated(scope, deps.io, { instanceId: redeemed.instanceId, contactId: redeemed.contactId, change: 'redeemed' });
    return redeemed;
  });
  return result.ok ? { ok: true as const, redeemedAt: result.redeemedAt, couponName: result.couponName } : result;
}

export function getWalletQrCodeFlow(deps: WalletFlowDeps, fan: FanIdentity, instanceId: string, now?: number) {
  return inFanTenant(deps, fan, (ctx) => getWalletQrCode(ctx, fan, instanceId, now));
}

