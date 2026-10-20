/**
 * 顧客券詳情與核銷畫面共用的樣式與文字工具（Figma 顧客端 (f) F.6 按鈕、F.13 明細列）。
 * 按鈕高 48、圓角 12；色彩一律用 globals.css 的 token，深色模式才讀得到。
 */
import type { FanCoupon } from '@/hooks/useFanCoupons';

const base =
  'inline-flex h-12 w-full items-center justify-center rounded-xl px-4 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed';

/** Primary：立即使用、出示 QR Code、確認核銷。停用時改灰底白字（設計稿 #C6CFDD）。 */
export const btnPrimary = `${base} bg-primary font-semibold text-primary-foreground hover:bg-primary-hover disabled:bg-muted-foreground/40 disabled:text-background disabled:hover:bg-muted-foreground/40`;
/** Subtle：取消，稍後使用、返回票券詳情、取消使用、重試 */
export const btnSubtle = `${base} border border-border bg-card font-medium text-muted-foreground hover:bg-muted disabled:opacity-60`;
/** Secondary：關閉 */
export const btnSecondary = `${base} border border-primary bg-primary-subtle font-medium text-primary hover:bg-primary/15`;

/** 核銷方式顯示名稱（核銷結果明細列） */
export const REDEEM_MODE_LABEL: Record<NonNullable<FanCoupon['coupon']['redeemMode']>, string> = {
  STAFF_CODE: '店員驗證碼',
  STAFF_SCAN: '店員掃碼',
  SELF: '顧客自助',
};

const p2 = (n: number) => String(n).padStart(2, '0');

/** 10-05 14:31（已使用膠囊） */
export function mdhm(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** 10/20（未到生效日的說明，設計稿用不補零的 M/D） */
export function md(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 倒數顯示 m:ss（設計稿 5:00、0:42）；超過一小時顯示 h:mm:ss */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}
