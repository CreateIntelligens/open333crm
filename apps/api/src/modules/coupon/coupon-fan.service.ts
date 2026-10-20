/**
 * 顧客端券夾的資料存取。身分一律由呼叫端傳入已驗簽的 fan（不接受請求帶 contactId），
 * 查詢走 withTenant，RLS 兜底。
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant } from '../../lib/tenant-db.js';
import type { FanPayload } from '../portal/portal-auth.service.js';

type FanIdentity = Pick<FanPayload, 'tenantId' | 'contactId'>;

/** 顧客端看得到的券欄位。刻意不含 claimToken 與內部識別。 */
export function toFanView(i: {
  id: string;
  code: string;
  status: string;
  expiresAt: Date | null;
  claimedAt: Date | null;
  openedAt: Date | null;
  redeemedAt: Date | null;
  coupon: {
    name: string; description: string | null; terms: string | null; imageUrl: string | null;
    couponType: string; discountAmount: number | null; discountPercent: number | null;
    validityMode: string; startAt: Date | null; redeemMode: string; afterOpenMinutes: number | null;
  };
}) {
  const now = new Date();
  // 未到生效日不露券號（spec：遮蔽並說明原因，不是給空白）
  const notYetValid =
    i.coupon.validityMode === 'FIXED' && i.coupon.startAt != null && i.coupon.startAt > now;

  return {
    id: i.id,
    code: notYetValid ? null : i.code,
    codeHidden: notYetValid,
    availableAt: notYetValid ? i.coupon.startAt : null,
    status: i.status,
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
      redeemMode: i.coupon.redeemMode,
      afterOpenMinutes: i.coupon.afterOpenMinutes,
    },
  };
}

const COUPON_INCLUDE = {
  coupon: {
    select: {
      name: true, description: true, terms: true, imageUrl: true,
      couponType: true, discountAmount: true, discountPercent: true,
      validityMode: true, startAt: true, redeemMode: true, afterOpenMinutes: true,
    },
  },
} as const;

/** 券夾。未指定狀態時排除未領取（UNCLAIMED）——那些券還在等人用憑證來領。 */
export async function listFanCoupons(prisma: PrismaClient, fan: FanIdentity, status?: string) {
  const items = await withTenant(prisma, fan.tenantId, (tx) =>
    tx.couponInstance.findMany({
      where: {
        tenantId: fan.tenantId,
        contactId: fan.contactId,
        status: status
          ? (status as never)
          : { in: ['CLAIMED', 'OPENED', 'REDEEMED', 'EXPIRED'] },
      },
      include: COUPON_INCLUDE,
      orderBy: [{ expiresAt: 'asc' }, { claimedAt: 'desc' }],
    }));
  return items.map(toFanView);
}

/** 單張券；不屬於此顧客時回 null。 */
export async function getFanCoupon(prisma: PrismaClient, fan: FanIdentity, id: string) {
  const instance = await withTenant(prisma, fan.tenantId, (tx) =>
    tx.couponInstance.findFirst({
      where: { id, tenantId: fan.tenantId, contactId: fan.contactId },
      include: COUPON_INCLUDE,
    }));
  return instance ? toFanView(instance) : null;
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
