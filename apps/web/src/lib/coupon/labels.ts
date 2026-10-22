/**
 * 優惠券後台的顯示文字。文案依《優惠券後台 UX 規則》與後台原型（Jira CM-196）。
 */
import type {
  Coupon,
  CouponPurpose,
  CouponStatus,
  CouponType,
  CodeMode,
  InstanceStatus,
  RedeemMode,
  ValidityMode,
} from '@/hooks/useCoupons';
import { pad2, taipeiParts } from '@/lib/taipei-time';

export const STATUS_LABEL: Record<CouponStatus, string> = {
  ACTIVE: '進行中',
  PAUSED: '已暫停',
  DRAFT: '草稿',
  ENDED: '已結束',
};

export const PURPOSE_LABEL: Record<CouponPurpose, string> = {
  SERVICE: '客服補償',
  MARKETING: '行銷推廣',
};

export const TYPE_LABEL: Record<CouponType, string> = {
  DISCOUNT_AMOUNT: '元折抵',
  DISCOUNT_PERCENT: '% 折扣',
  GIFT: '贈品',
  EXCHANGE: '兌換',
};

export const VALIDITY_LABEL: Record<ValidityMode, string> = {
  FIXED: '固定起訖',
  AFTER_CLAIM: '領取後 N 天',
  AFTER_OPEN: '開啟後 N 分鐘',
};

/** 列表效期第二行只顯示效期類型（UX 規則差異 D14：不混用序號模式的文字） */
export const VALIDITY_KIND: Record<ValidityMode, string> = {
  FIXED: '固定起訖',
  AFTER_CLAIM: '相對效期',
  AFTER_OPEN: '即開即用',
};

export const CODE_MODE_LABEL: Record<CodeMode, string> = {
  UNIQUE_CODE: '一人一碼',
  SHARED_CODE: '共用碼',
  IMPORTED_CODES: '序號包匯入',
};

export const REDEEM_MODE_LABEL: Record<RedeemMode, string> = {
  STAFF_CODE: '店員驗證碼',
  STAFF_SCAN: '店員掃碼',
  SELF: '顧客自助',
};

/** 序號明細的狀態；已開啟（OPENED）對客服而言也是「已領取」 */
export const INSTANCE_STATUS_LABEL: Record<InstanceStatus, string> = {
  ISSUED: '未領取',
  CLAIMED: '已領取',
  OPENED: '已領取',
  REDEEMED: '已使用',
  EXPIRED: '已過期',
  REVOKED: '已作廢',
};

export function formatNumber(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('zh-TW');
}

/** 2026-10-31（ISO 或 Date）→ 2026/10/31 */
export function formatDate(value: string | Date | null | undefined): string {
  const d = taipeiParts(value);
  return d ? `${d.year}/${pad2(d.month)}/${pad2(d.day)}` : '—';
}

/** 序號明細的時間：YYYY-MM-DD HH:mm */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = taipeiParts(value);
  return d ? `${d.year}-${pad2(d.month)}-${pad2(d.day)} ${pad2(d.hour)}:${pad2(d.minute)}` : '—';
}

/** 列表與詳情的效期值，例如「2026/10/01 – 10/31」「領取後 30 天」「開啟後 15 分鐘」 */
export function validityText(c: Pick<Coupon, 'validityMode' | 'startAt' | 'endAt' | 'afterClaimDays' | 'afterOpenMinutes'>): string {
  switch (c.validityMode) {
    case 'FIXED': {
      if (!c.startAt || !c.endAt) return '—';
      const start = formatDate(c.startAt);
      const end = formatDate(c.endAt);
      // 同一年只寫一次年份
      return start.slice(0, 4) === end.slice(0, 4) ? `${start} – ${end.slice(5)}` : `${start} – ${end}`;
    }
    case 'AFTER_CLAIM':
      return c.afterClaimDays ? `領取後 ${c.afterClaimDays} 天` : '—';
    case 'AFTER_OPEN':
      return c.afterOpenMinutes ? `開啟後 ${c.afterOpenMinutes} 分鐘` : '—';
    default:
      return '—';
  }
}

/** 券型與面額摘要，例如「元折抵 · 折 NT$100 · 滿 NT$1,000」 */
export function faceValueText(
  c: Pick<Coupon, 'couponType' | 'discountAmount' | 'discountPercent' | 'minSpend' | 'percentCap' | 'giftName' | 'giftQty' | 'exchangeItem' | 'exchangeValueCap'>,
): string {
  const nt = (n: number) => `NT$${n.toLocaleString('zh-TW')}`;
  switch (c.couponType) {
    case 'DISCOUNT_AMOUNT':
      return [
        '元折抵',
        c.discountAmount ? `折 ${nt(c.discountAmount)}` : null,
        c.minSpend ? `滿 ${nt(c.minSpend)}` : '無門檻',
      ].filter(Boolean).join(' · ');
    case 'DISCOUNT_PERCENT':
      return [
        '% 折扣',
        c.discountPercent ? `打 ${100 - c.discountPercent} 折` : null,
        c.percentCap ? `最多折 ${nt(c.percentCap)}` : '無折抵上限',
      ].filter(Boolean).join(' · ');
    case 'GIFT':
      return ['贈品', c.giftName, c.giftQty ? `${c.giftQty} 份` : null].filter(Boolean).join(' · ');
    case 'EXCHANGE':
      return ['兌換', c.exchangeItem, c.exchangeValueCap ? `價值上限 ${nt(c.exchangeValueCap)}` : null]
        .filter(Boolean)
        .join(' · ');
    default:
      return '—';
  }
}

/** 百分比取小數 1 位；分母為 0 時為 0.0%（UX 規則：詳情指標卡） */
export function percent(numerator: number, denominator: number): string {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
