/**
 * 領取與核銷。本檔是整個券系統最需要正確性的部分。
 *
 * 兩個核心保證：
 * 1. 核銷防重複——交易內條件式更新搶狀態（WHERE status='CLAIMED'），
 *    受影響列數 0 即已被他人核銷。不依賴「先查再改」，那在併發下必然出錯。
 * 2. 失敗需分類——已使用／已過期／尚未生效／查無此券要能分別回報，
 *    只回「失敗」會讓店員無法向顧客解釋。
 */
import type { Prisma } from '@prisma/client';
import { couponCodeKey, logger } from '@open333crm/core';
import type { TenantCtx } from '../../lib/tenant-ctx.js';

export type RedeemFailure =
  | 'NOT_FOUND'
  | 'ALREADY_REDEEMED'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'REVOKED'
  | 'NOT_CLAIMED'
  /** 開啟後計時的券還沒開啟：效期從開啟起算，不開啟就核銷等於沒有期限 */
  | 'NOT_OPENED'
  | 'STAFF_CODE_REQUIRED'
  | 'STAFF_CODE_MISMATCH'
  | 'SELF_REDEEM_NOT_ALLOWED'
  /** 核銷台只核銷店員掃碼券（onlyMode），其他方式要在顧客手機上核銷 */
  | 'WRONG_MODE'
  | 'CONFLICT';

export interface RedeemSuccess {
  ok: true;
  instanceId: string;
  /** 持有者（即時事件用，design D23） */
  contactId: string | null;
  couponName: string;
  code: string;
  redeemedAt: Date;
}

export interface RedeemError {
  ok: false;
  reason: RedeemFailure;
  /** 已核銷時附上原核銷時間，讓店員能判斷是否為同一次交易的重複掃描 */
  redeemedAt?: Date;
  /** 已核銷時附上核銷門市（核銷台核銷的才有） */
  redeemedStoreName?: string | null;
}


/** 顧客開啟券。AFTER_OPEN 模式由此刻起算效期，故需記錄 openedAt。 */
export async function openInstance(
  ctx: TenantCtx,
  instanceId: string,
  contactId: string,
): Promise<{ ok: true; expiresAt: Date | null } | { ok: false; reason: 'NOT_FOUND' | 'CANNOT_OPEN'; expiresAt: Date | null }> {
  const { tx, tenantId } = ctx;
  const instance = await tx.couponInstance.findFirst({
    where: { id: instanceId, tenantId, contactId },
    include: { coupon: true },
  });
  // 別人的券與不存在的券一樣回查無此券，不透露券是否存在
  if (!instance) return { ok: false, reason: 'NOT_FOUND', expiresAt: null };
  // 已開啟過就不重設計時，否則顧客可反覆開啟來延長效期
  if (instance.status !== 'CLAIMED') {
    return instance.status === 'OPENED'
      ? { ok: true, expiresAt: instance.expiresAt }
      : { ok: false, reason: 'CANNOT_OPEN', expiresAt: instance.expiresAt };
  }

  const now = new Date();
  const expiresAt =
    instance.coupon.validityMode === 'AFTER_OPEN' && instance.coupon.afterOpenMinutes
      ? new Date(now.getTime() + instance.coupon.afterOpenMinutes * 60 * 1000)
      : instance.expiresAt;

  const updated = await tx.couponInstance.updateMany({
    where: { id: instanceId, tenantId, status: 'CLAIMED' },
    data: { status: 'OPENED', openedAt: now, expiresAt },
  });
  if (updated.count === 0) return { ok: false, reason: 'CANNOT_OPEN', expiresAt: null };
  return { ok: true, expiresAt };
}

export interface RedeemInput {
  /** 以券號核銷（核銷台）或以 instanceId 核銷（顧客自助） */
  code?: string;
  instanceId?: string;
  /** 店員核銷時必填，自助核銷為 null */
  redeemedBy?: string | null;
  /** 店員驗證碼模式下顧客／店員輸入的碼 */
  staffCode?: string;
  /** 由顧客端發起時為 true，用於擋非自助券 */
  selfService?: boolean;
  redeemChannel?: string;
  /** 只允許這種核銷方式（核銷台傳 STAFF_SCAN） */
  onlyMode?: 'STAFF_SCAN';
  /** 在核銷台核銷時記錄的門市與門市帳號（design D13） */
  store?: { id: string; name: string; account: string };
}

export async function redeemCoupon(
  ctx: TenantCtx,
  input: RedeemInput,
): Promise<RedeemSuccess | RedeemError> {
  const { tx, tenantId } = ctx;
  // 以券號核銷時與核銷台相同的比對鍵：忽略連字號、空白、大小寫與全形（core couponCodeKey）
  let instanceId = input.instanceId;
  if (!instanceId) {
    const key = couponCodeKey(input.code ?? '');
    const rows = key
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM coupon_instances
          WHERE "tenantId" = ${tenantId}::uuid
            AND upper(regexp_replace("code", '[^A-Za-z0-9]', '', 'g')) = ${key}`
      : [];
    instanceId = rows[0]?.id;
  }
  const instance = instanceId
    ? await tx.couponInstance.findFirst({ where: { id: instanceId, tenantId }, include: { coupon: true } })
    : null;
  if (!instance) return { ok: false as const, reason: 'NOT_FOUND' as const };

  // 先判終態，讓回報的原因是使用者能理解的那一個
  if (instance.status === 'REDEEMED') {
    return {
      ok: false as const,
      reason: 'ALREADY_REDEEMED' as const,
      redeemedAt: instance.redeemedAt ?? undefined,
      redeemedStoreName: instance.redeemedStoreName,
    };
  }
  if (instance.status === 'REVOKED') return { ok: false as const, reason: 'REVOKED' as const };
  if (instance.status === 'EXPIRED') return { ok: false as const, reason: 'EXPIRED' as const };
  if (instance.status === 'ISSUED') return { ok: false as const, reason: 'NOT_CLAIMED' as const };
  // 提前結束的券一律不能用（作廢與發券同時進行時的最後一道防線）；暫停不影響（design D18）
  if (instance.coupon.status === 'ENDED') return { ok: false as const, reason: 'REVOKED' as const };

  const now = new Date();
  if (instance.expiresAt && instance.expiresAt <= now) {
    return { ok: false as const, reason: 'EXPIRED' as const };
  }
  if (instance.coupon.validityMode === 'FIXED' && instance.coupon.startAt && instance.coupon.startAt > now) {
    return { ok: false as const, reason: 'NOT_YET_VALID' as const };
  }
  if (instance.coupon.validityMode === 'AFTER_OPEN' && instance.status === 'CLAIMED') {
    return { ok: false as const, reason: 'NOT_OPENED' as const };
  }

  const redeemMode = instance.coupon.redeemMode;
  if (input.onlyMode && redeemMode !== input.onlyMode) {
    return { ok: false as const, reason: 'WRONG_MODE' as const };
  }

  // 顧客端只能核銷自助券——非自助券須經店員，否則核銷方式的設定形同虛設
  if (input.selfService && redeemMode !== 'SELF') {
    return { ok: false as const, reason: 'SELF_REDEEM_NOT_ALLOWED' as const };
  }
  if (redeemMode === 'STAFF_CODE' && !input.selfService) {
    if (!input.staffCode) return { ok: false as const, reason: 'STAFF_CODE_REQUIRED' as const };
    if (input.staffCode.trim() !== (instance.coupon.staffCode ?? '')) {
      return { ok: false as const, reason: 'STAFF_CODE_MISMATCH' as const };
    }
  }

  // 核心防重複：狀態必須仍是可核銷的那兩個，否則已被他人搶先
  const claimed = await tx.couponInstance.updateMany({
    where: { id: instance.id, tenantId, status: { in: ['CLAIMED', 'OPENED'] } },
    data: {
      status: 'REDEEMED',
      redeemedAt: now,
      redeemedBy: input.redeemedBy ?? null,
      // 存當下的核銷方式，日後改券設定不影響既有紀錄
      redeemMode,
      redeemChannel: input.redeemChannel ?? null,
      ...(input.store
        ? { redeemedStoreId: input.store.id, redeemedStoreName: input.store.name, redeemedStoreAccount: input.store.account }
        : {}),
    },
  });
  if (claimed.count === 0) return { ok: false as const, reason: 'CONFLICT' as const };

  // 收件匣「已發優惠券」重新載入（design D23）由每個入口依回傳的 instanceId、contactId 推播（coupon-effects.ts）
  return {
    ok: true as const,
    instanceId: instance.id,
    contactId: instance.contactId,
    couponName: instance.coupon.name,
    code: instance.code,
    redeemedAt: now,
  };
}
