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
import { logger } from '@open333crm/core';
import { withTenant } from '../../lib/tenant-db.js';
import { addTagToTarget } from '../tag/tagging.service.js';

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
  | 'CONFLICT';

export type ClaimFailure =
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'ALREADY_CLAIMED'
  | 'COUPON_INACTIVE'
  | 'CONFLICT';

export interface RedeemSuccess {
  ok: true;
  instanceId: string;
  couponName: string;
  code: string;
  redeemedAt: Date;
}

export interface RedeemError {
  ok: false;
  reason: RedeemFailure;
  /** 已核銷時附上原核銷時間，讓店員能判斷是否為同一次交易的重複掃描 */
  redeemedAt?: Date;
}

/**
 * 領取時自動貼標（B4.1）。
 *
 * 失敗不影響領取——標籤是行銷輔助，券才是顧客要的東西。
 * 因貼標失敗而讓整筆領取回滾，顧客會看到「領取失敗」但券碼已被消耗。
 */
async function applyClaimTag(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactId: string,
  claimTagId: string | null,
): Promise<void> {
  if (!claimTagId) return;
  try {
    await addTagToTarget(tx, {
      tenantId,
      targetType: 'CONTACT',
      targetId: contactId,
      tagId: claimTagId,
      // 非人工路徑，標記來源為 system 以便日後區分
      addedBy: 'system',
    });
  } catch (err) {
    logger.warn('[Coupon] 領取貼標失敗（不影響領取）', {
      tenantId,
      contactId,
      tagId: claimTagId,
      error: (err as Error).message,
    });
  }
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

    if (instance.status !== 'ISSUED') {
      return { ok: false as const, reason: 'ALREADY_CLAIMED' as const };
    }
    if (instance.claimTokenExpiresAt && instance.claimTokenExpiresAt <= new Date()) {
      return { ok: false as const, reason: 'TOKEN_EXPIRED' as const };
    }
    if (instance.coupon.status === 'ENDED') {
      return { ok: false as const, reason: 'COUPON_INACTIVE' as const };
    }

    const now = new Date();
    // AFTER_CLAIM 的效期自領取此刻起算
    const expiresAt =
      instance.coupon.validityMode === 'AFTER_CLAIM' && instance.coupon.afterClaimDays
        ? new Date(now.getTime() + instance.coupon.afterClaimDays * 24 * 60 * 60 * 1000)
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

    await applyClaimTag(tx, tenantId, contactId, instance.coupon.claimTagId);

    return { ok: true as const, instanceId: instance.id, couponId: instance.couponId };
  });
}

/** 顧客開啟券。AFTER_OPEN 模式由此刻起算效期，故需記錄 openedAt。 */
export async function openInstance(
  prisma: PrismaClient,
  tenantId: string,
  instanceId: string,
  contactId: string,
): Promise<{ ok: boolean; expiresAt: Date | null }> {
  return withTenant(prisma, tenantId, async (tx) => {
    const instance = await tx.couponInstance.findFirst({
      where: { id: instanceId, tenantId, contactId },
      include: { coupon: true },
    });
    if (!instance) return { ok: false, expiresAt: null };
    // 已開啟過就不重設計時，否則顧客可反覆開啟來延長效期
    if (instance.status !== 'CLAIMED') {
      return { ok: instance.status === 'OPENED', expiresAt: instance.expiresAt };
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
    if (updated.count === 0) return { ok: false, expiresAt: null };
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
      },
    });
    if (claimed.count === 0) return { ok: false as const, reason: 'CONFLICT' as const };

    return {
      ok: true as const,
      instanceId: instance.id,
      couponName: instance.coupon.name,
      code: instance.code,
      redeemedAt: now,
    };
  });
}
