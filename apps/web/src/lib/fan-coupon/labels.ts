/**
 * 顧客票券夾的顯示文字。文案依 Figma「優惠券系統 (New)」顧客端（Jira CM-197）。
 */
import type { FanCoupon, WalletStatus } from '@/hooks/useFanCoupons';

const p2 = (n: number) => String(n).padStart(2, '0');

/** 2026-10-31 */
export function ymd(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** 2026-10-05 14:31 */
export function ymdhm(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${ymd(value)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 2026-10-05 14:31:07（核銷結果到秒） */
export function ymdhms(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${ymdhm(value)}:${p2(d.getSeconds())}`;
}

/**
 * 票根上的面額：主數字＋前後綴。
 * 例：NT$ 100 折抵／85 折／贈品 1 個／兌換 1 杯（單位由後台品項決定，沒有就用「份」）
 */
export function faceValue(c: FanCoupon['coupon']): { prefix: string; value: string; suffix: string; caption?: string } {
  switch (c.couponType) {
    case 'DISCOUNT_AMOUNT':
      return { prefix: 'NT$', value: String(c.discountAmount ?? 0), suffix: '', caption: '折抵' };
    case 'DISCOUNT_PERCENT':
      // 後端存「折掉幾 %」，台灣慣用「打幾折」：15 → 85 折
      return { prefix: '', value: String(100 - (c.discountPercent ?? 0)), suffix: '折' };
    case 'GIFT':
      return { prefix: '贈品', value: String(c.giftQty ?? 1), suffix: '份' };
    case 'EXCHANGE':
      return { prefix: '兌換', value: '1', suffix: '份' };
    default:
      return { prefix: '', value: '', suffix: '' };
  }
}

/** 使用條件的一句話，例：滿 NT$1,000 可用／最多折 NT$300／贈送 濾網 ×1／限兌換 冷氣清洗 */
export function conditionText(c: FanCoupon['coupon']): string {
  const nt = (n: number) => `NT$${n.toLocaleString('zh-TW')}`;
  switch (c.couponType) {
    case 'DISCOUNT_AMOUNT':
      return c.minSpend ? `滿 ${nt(c.minSpend)} 可用` : '無最低消費限制';
    case 'DISCOUNT_PERCENT':
      return c.percentCap ? `最多折 ${nt(c.percentCap)}` : '無折抵上限';
    case 'GIFT':
      return c.giftName ? `贈送 ${c.giftName} ×${c.giftQty ?? 1}` : '';
    case 'EXCHANGE':
      return c.exchangeItem ? `限兌換 ${c.exchangeItem}` : '';
    default:
      return '';
  }
}

/** 列表卡片第二行 */
export function cardSubtitle(item: FanCoupon): string {
  if (item.walletStatus === 'NOT_YET') return `${ymd(item.availableAt)} 起可使用`;
  if (item.walletStatus === 'USED') return `${ymd(item.redeemedAt)} 已使用`;
  if (item.expiresAt) return `有效期限至 ${ymd(item.expiresAt)}`;
  if (item.coupon.validityMode === 'AFTER_OPEN' && item.coupon.afterOpenMinutes) {
    return `開啟後 ${item.coupon.afterOpenMinutes} 分鐘內使用`;
  }
  return '';
}

/** 狀態標籤文字（列表與詳情共用；設計稿兩處用詞不一，統一用詳情的說法） */
export function statusLabel(item: Pick<FanCoupon, 'walletStatus' | 'daysLeft' | 'redeemedAt' | 'coupon'>): string {
  const labels: Record<WalletStatus, string> = {
    AVAILABLE: '可使用',
    EXPIRING: `即將到期：餘 ${item.daysLeft ?? 0} 天`,
    NOT_YET: '未到生效日',
    USED: item.coupon.couponType === 'EXCHANGE' ? '已兌換' : '已使用',
    EXPIRED: '已過期',
    ENDED: '活動已提前結束',
  };
  return labels[item.walletStatus];
}

/** 使用說明（依核銷方式） */
export const HOW_TO_USE: Record<NonNullable<FanCoupon['coupon']['redeemMode']>, string> = {
  STAFF_CODE: '結帳時按「立即使用」，再把手機交給店員輸入驗證碼',
  STAFF_SCAN: '結帳時出示，由店員掃描 QR Code 或輸入券號',
  SELF: '結帳時按「立即使用」並滑動確認',
};
