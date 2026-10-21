/**
 * 領取與核銷。本檔是整個券系統最需要正確性的部分。
 *
 * 兩個核心保證：
 * 1. 核銷防重複——交易內條件式更新搶狀態（WHERE status='CLAIMED'），
 *    受影響列數 0 即已被他人核銷。不依賴「先查再改」，那在併發下必然出錯。
 * 2. 失敗需分類——已使用／已過期／尚未生效／查無此券要能分別回報，
 *    只回「失敗」會讓店員無法向顧客解釋。
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { afterClaimExpiry, logger } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { applyClaimTag } from './coupon-tagging.js';

export type RedeemFailure =
  | 'NOT_FOUND'
  | 'ALREADY_REDEEMED'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'REVOKED'
  | 'NOT_CLAIMED'
  | 'STAFF_CODE_REQUIRED'
  | 'STAFF_CODE_MISMATCH'
  | 'SELF_REDEEM_NOT_ALLOWED'
  /** 核銷台只核銷店員掃碼券（onlyMode），其他方式要在顧客手機上核銷 */
  | 'WRONG_MODE'
  | 'CONFLICT';

export type ClaimFailure =
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'ALREADY_CLAIMED'
  | 'COUPON_INACTIVE'
  | 'PER_CONTACT_LIMIT_REACHED'
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


/**
 * 以領取憑證換券並歸戶（design D10）。
 *
 * 憑證全域唯一，故此處先不帶 tenantId 查找——租戶由券本身決定。
 * 這是少數「先查再定租戶」的合法情形，查到後所有後續操作都綁該租戶。
 */
export async function claimByToken(
  prisma: PrismaClient,
  token: string,
  contactId: string,
  tenantId: string,
): Promise<{ ok: true; instanceId: string; couponId: string } | { ok: false; reason: ClaimFailure }> {
  return withTenant(prisma, tenantId, async (tx) => {
    const instance = await tx.couponInstance.findFirst({
      where: { claimToken: token, tenantId },
      include: { coupon: true },
    });
    if (!instance) return { ok: false as const, reason: 'TOKEN_NOT_FOUND' as const };

    // 已作廢或過期的券不是「被別人領走」，告訴顧客活動已結束
    if (instance.status === 'REVOKED' || instance.status === 'EXPIRED') {
      return { ok: false as const, reason: 'COUPON_INACTIVE' as const };
    }
    if (instance.status !== 'ISSUED') {
      return { ok: false as const, reason: 'ALREADY_CLAIMED' as const };
    }
    if (instance.claimTokenExpiresAt && instance.claimTokenExpiresAt <= new Date()) {
      return { ok: false as const, reason: 'TOKEN_EXPIRED' as const };
    }
    if (instance.coupon.status === 'ENDED') {
      return { ok: false as const, reason: 'COUPON_INACTIVE' as const };
    }

    // 領取會把券改綁到領取者身上，也要遵守每人上限（與發券同一把鎖、同一套計算）
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${instance.couponId}, 0))`;
    const held = await tx.couponInstance.count({
      where: {
        tenantId,
        couponId: instance.couponId,
        contactId,
        id: { not: instance.id },
        status: { in: ['ISSUED', 'CLAIMED', 'OPENED', 'REDEEMED'] },
      },
    });
    if (held >= instance.coupon.perContactLimit) {
      return { ok: false as const, reason: 'PER_CONTACT_LIMIT_REACHED' as const };
    }

    const now = new Date();
    // AFTER_CLAIM 的效期自領取當天（台灣日期）起算，第 N 天結束時到期（design D17）
    const expiresAt =
      instance.coupon.validityMode === 'AFTER_CLAIM' && instance.coupon.afterClaimDays
        ? afterClaimExpiry(now, instance.coupon.afterClaimDays)
        : instance.expiresAt;

    // 搶佔：憑證一次性，兩人同時點同一連結只有一個能成功
    const taken = await tx.couponInstance.updateMany({
      where: { id: instance.id, tenantId, status: 'ISSUED', claimToken: token },
      data: {
        contactId,
        status: 'CLAIMED',
        claimedAt: now,
        claimToken: null,
        claimTokenExpiresAt: null,
        expiresAt,
      },
    });
    if (taken.count === 0) return { ok: false as const, reason: 'CONFLICT' as const };

    await applyClaimTag(tx, tenantId, contactId, instance.coupon);

    return { ok: true as const, instanceId: instance.id, couponId: instance.couponId };
  });
}

/** 顧客開啟券。AFTER_OPEN 模式由此刻起算效期，故需記錄 openedAt。 */
export async function openInstance(
  prisma: PrismaClient,
  tenantId: string,
  instanceId: string,
  contactId: string,
): Promise<{ ok: true; expiresAt: Date | null } | { ok: false; reason: 'NOT_FOUND' | 'CANNOT_OPEN'; expiresAt: Date | null }> {
  return withTenant(prisma, tenantId, async (tx) => {
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
  });
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
  prisma: PrismaClient,
  tenantId: string,
  input: RedeemInput,
): Promise<RedeemSuccess | RedeemError> {
  return withTenant(prisma, tenantId, async (tx) => {
    const instance = await tx.couponInstance.findFirst({
      where: input.instanceId
        ? { id: input.instanceId, tenantId }
        : { code: input.code ?? '', tenantId },
      include: { coupon: true },
    });
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

    const now = new Date();
    if (instance.expiresAt && instance.expiresAt <= now) {
      return { ok: false as const, reason: 'EXPIRED' as const };
    }
    if (instance.coupon.validityMode === 'FIXED' && instance.coupon.startAt && instance.coupon.startAt > now) {
      return { ok: false as const, reason: 'NOT_YET_VALID' as const };
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

    return {
      ok: true as const,
      instanceId: instance.id,
      contactId: instance.contactId,
      couponName: instance.coupon.name,
      code: instance.code,
      redeemedAt: now,
    };
  });
}
