/**
 * 顧客票券夾的入口（公開端點，沒有登入的座席）：租戶由票券權杖或顧客憑證決定，
 * 這裡以 inTenant() 開交易，再呼叫只收 TenantCtx 的 service（AGENTS.md 結構規則 2）。
 *
 * 路由與測試都經過這裡，所以交易邊界只有一份。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { readWalletToken } from '@open333crm/core';
import { inTenant, type TenantCtx } from '../../lib/tenant-ctx.js';
import { eventBus } from '../../events/event-bus.js';
import type { FanIdentity } from './coupon-fan.service.js';
import {
  getWalletCoupon,
  getWalletQrCode,
  lineLoginTarget,
  listWallet,
  markLineVerified,
  openWalletSession,
  redeemWithStaffCode,
  startStaffCodeSession,
  type LineLoginDeps,
  type LineLoginResult,
  type WalletDeps,
  type WalletSessionResult,
} from './coupon-wallet.service.js';

export interface WalletFlowDeps extends WalletDeps {
  prisma: PrismaClient;
  /** 推播「已發優惠券」更新；沒有 io 時 service 推播會丟錯（寫錯程式要看得到） */
  io: Server;
}

function inTenantOf<T>(deps: WalletFlowDeps, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return inTenant({ prisma: deps.prisma, io: deps.io, events: eventBus }, tenantId, fn);
}

/** 以顧客憑證的租戶開交易 */
export function inFanTenant<T>(deps: WalletFlowDeps, fan: FanIdentity, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return inTenantOf(deps, fan.tenantId, fn);
}

/** 票券連結換顧客憑證：權杖決定租戶，不信任網址參數 */
export async function openWalletSessionFlow(deps: WalletFlowDeps, token: string): Promise<WalletSessionResult> {
  const payload = await readWalletToken(deps.store, token);
  if (!payload) return { status: 'expired' };
  return inTenantOf(deps, payload.tenantId, (ctx) => openWalletSession(ctx, deps, payload, token));
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

export function startStaffCodeSessionFlow(deps: WalletFlowDeps, fan: FanIdentity, instanceId: string) {
  return inFanTenant(deps, fan, (ctx) => startStaffCodeSession(ctx, deps, fan, instanceId));
}

export function redeemWithStaffCodeFlow(deps: WalletFlowDeps, fan: FanIdentity, instanceId: string, code: string) {
  return inFanTenant(deps, fan, (ctx) => redeemWithStaffCode(ctx, deps, fan, instanceId, code));
}

export function getWalletQrCodeFlow(deps: WalletFlowDeps, fan: FanIdentity, instanceId: string, now?: number) {
  return inFanTenant(deps, fan, (ctx) => getWalletQrCode(ctx, fan, instanceId, now));
}
