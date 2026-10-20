/**
 * 顧客端券夾的資料存取與狀態判定。身分一律由呼叫端傳入已驗簽的 fan（不接受請求帶 contactId），
 * 查詢走 withTenant，RLS 兜底。
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant } from '../../lib/tenant-db.js';
import type { FanPayload } from '../portal/portal-auth.service.js';

export type FanIdentity = Pick<FanPayload, 'tenantId' | 'contactId'>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** 剩幾天內算「即將到期」（UX 未定義，暫定 3 天；見 tasks 待 PM 確認） */
export const EXPIRING_DAYS = 3;

/**
 * 顧客看到的券狀態：
 * - AVAILABLE／EXPIRING／NOT_YET → 可使用分頁
 * - USED → 已使用分頁
 * - EXPIRED／ENDED → 已失效分頁（ENDED＝商家提前結束活動而作廢）
 */
export type WalletStatus = 'AVAILABLE' | 'EXPIRING' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'ENDED';
export type WalletTab = 'available' | 'used' | 'invalid';

/**
 * 依券的狀態、到期時間與生效日判定顧客看到的狀態。
 * 到期沒有排程把狀態改成 EXPIRED，所以已過 expiresAt 的已領取券在這裡判定為已過期。
 */
export function walletStatusOf(
  i: { status: string; expiresAt: Date | null },
  c: { validityMode: string | null; startAt: Date | null },
  now: number,
): { walletStatus: WalletStatus; daysLeft?: number } {
  if (i.status === 'REDEEMED') return { walletStatus: 'USED' };
  // 作廢只來自「提前結束」：顧客端說明為活動已提前結束
  if (i.status === 'REVOKED') return { walletStatus: 'ENDED' };
  if (i.status === 'EXPIRED' || (i.expiresAt && i.expiresAt.getTime() <= now)) return { walletStatus: 'EXPIRED' };
  if (c.validityMode === 'FIXED' && c.startAt && c.startAt.getTime() > now) return { walletStatus: 'NOT_YET' };
  if (i.expiresAt) {
    const daysLeft = Math.ceil((i.expiresAt.getTime() - now) / DAY_MS);
    if (daysLeft <= EXPIRING_DAYS) return { walletStatus: 'EXPIRING', daysLeft };
  }
  return { walletStatus: 'AVAILABLE' };
}

export function walletTabOf(status: WalletStatus): WalletTab {
  if (status === 'USED') return 'used';
  if (status === 'EXPIRED' || status === 'ENDED') return 'invalid';
  return 'available';
}

const COUPON_SELECT = {
  name: true, description: true, terms: true, imageUrl: true,
  couponType: true, discountAmount: true, discountPercent: true, minSpend: true, percentCap: true,
  giftName: true, giftQty: true, exchangeItem: true, exchangeValueCap: true,
  validityMode: true, startAt: true, endAt: true, afterClaimDays: true, afterOpenMinutes: true,
  redeemMode: true, maskCodeBeforeStart: true,
} as const;

export const COUPON_INCLUDE = { coupon: { select: COUPON_SELECT } } as const;

type FanCoupon = {
  name: string; description: string | null; terms: string | null; imageUrl: string | null;
  couponType: string | null; discountAmount: number | null; discountPercent: number | null;
  minSpend?: number | null; percentCap?: number | null; giftName?: string | null; giftQty?: number | null;
  exchangeItem?: string | null; exchangeValueCap?: number | null;
  validityMode: string | null; startAt: Date | null; endAt?: Date | null; afterClaimDays?: number | null;
  afterOpenMinutes: number | null; redeemMode: string | null; maskCodeBeforeStart?: boolean;
};

/** 顧客端看得到的券欄位。刻意不含 claimToken、店員驗證碼與內部識別。 */
export function toFanView(
  i: {
    id: string;
    code: string;
    status: string;
    expiresAt: Date | null;
    claimedAt: Date | null;
    openedAt: Date | null;
    redeemedAt: Date | null;
    coupon: FanCoupon;
  },
  now: number = Date.now(),
) {
  const { walletStatus, daysLeft } = walletStatusOf(i, i.coupon, now);
  // 未到生效日不露券號（spec：遮蔽並說明原因，不是給空白）；商家可關閉遮蔽
  const hideCode = walletStatus === 'NOT_YET' && i.coupon.maskCodeBeforeStart !== false;
  const notYetValid = walletStatus === 'NOT_YET';

  return {
    id: i.id,
    code: hideCode ? null : i.code,
    codeHidden: hideCode,
    availableAt: notYetValid ? i.coupon.startAt : null,
    status: i.status,
    walletStatus,
    walletTab: walletTabOf(walletStatus),
    daysLeft: daysLeft ?? null,
    expiresAt: i.expiresAt,
    claimedAt: i.claimedAt,
    openedAt: i.openedAt,
    redeemedAt: i.redeemedAt,
    coupon: {
      name: i.coupon.name,
      description: i.coupon.description,
      // 條款已於儲存時消毒，此處直接輸出，不再二次轉義
      terms: i.coupon.terms,
      imageUrl: i.coupon.imageUrl,
      couponType: i.coupon.couponType,
      discountAmount: i.coupon.discountAmount,
      discountPercent: i.coupon.discountPercent,
      minSpend: i.coupon.minSpend ?? null,
      percentCap: i.coupon.percentCap ?? null,
      giftName: i.coupon.giftName ?? null,
      giftQty: i.coupon.giftQty ?? null,
      exchangeItem: i.coupon.exchangeItem ?? null,
      exchangeValueCap: i.coupon.exchangeValueCap ?? null,
      validityMode: i.coupon.validityMode,
      startAt: i.coupon.startAt,
      endAt: i.coupon.endAt ?? null,
      redeemMode: i.coupon.redeemMode,
      afterOpenMinutes: i.coupon.afterOpenMinutes,
    },
  };
}

export type FanCouponView = ReturnType<typeof toFanView>;

/**
 * 券夾：顧客名下已領取的券與各分頁數量。未領取（ISSUED）的券還在等人用憑證來領，不算顧客的券。
 * 排序：可使用的依到期時間由近到遠，其餘依領取時間由新到舊。
 */
export async function listFanCoupons(prisma: PrismaClient, fan: FanIdentity, now: number = Date.now()) {
  const rows = await withTenant(prisma, fan.tenantId, (tx) =>
    tx.couponInstance.findMany({
      where: { tenantId: fan.tenantId, contactId: fan.contactId, status: { not: 'ISSUED' } },
      include: COUPON_INCLUDE,
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { claimedAt: 'desc' }],
    }));
  const items = rows.map((r) => toFanView(r, now));
  const counts = { available: 0, used: 0, invalid: 0 };
  for (const item of items) counts[item.walletTab] += 1;
  return { items, counts };
}

/** 單張券；不屬於此顧客時回 null。 */
export async function getFanCoupon(prisma: PrismaClient, fan: FanIdentity, id: string, now: number = Date.now()) {
  const instance = await withTenant(prisma, fan.tenantId, (tx) =>
    tx.couponInstance.findFirst({
      where: { id, tenantId: fan.tenantId, contactId: fan.contactId },
      include: COUPON_INCLUDE,
    }));
  return instance ? toFanView(instance, now) : null;
}

/** 這張券是否屬於此顧客。核銷前先確認，避免以他人 instanceId 觸發核銷。 */
export async function isOwnedByFan(prisma: PrismaClient, fan: FanIdentity, id: string): Promise<boolean> {
  const owned = await withTenant(prisma, fan.tenantId, (tx) =>
    tx.couponInstance.findFirst({
      where: { id, tenantId: fan.tenantId, contactId: fan.contactId },
      select: { id: true },
    }));
  return owned != null;
}
