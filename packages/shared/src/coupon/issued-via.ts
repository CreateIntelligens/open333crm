/**
 * 優惠券的發放方式代碼（add-coupon-system design D32）。
 *
 * `CouponInstance.issuedVia` 只寫這裡的代碼。API、workers 寫入，後台（apps/web）顯示，
 * core 的 `couponSourceName` 依它帶預設來源名稱；全部讀這一份，代碼與文字才不會各寫一套而不一致。
 */

export const COUPON_ISSUED_VIA = {
  /** 對話發券（座席在收件匣發） */
  INBOX: 'inbox',
  /** 關鍵字回覆頁設定的發券規則 */
  KEYWORD: 'keyword',
  /** 加好友禮 */
  FOLLOW: 'follow',
  /** 其他觸發事件的既有自動化規則 */
  AUTOMATION: 'automation',
  /** 附券廣播 */
  BROADCAST: 'broadcast',
  /** 券詳情頁的批次發放（底層是附券廣播，design D31） */
  BATCH: 'batch',
  /** 公開領券連結（傳訊領券，design D30） */
  PUBLIC_LINK: 'public_link',
  /** `POST /api/v1/coupons/:id/issue`（CLI、合作夥伴等系統整合） */
  API: 'api',
} as const;

export type CouponIssuedVia = (typeof COUPON_ISSUED_VIA)[keyof typeof COUPON_ISSUED_VIA];

/** 發放方式的顯示文字（序號明細的「發放方式」） */
export const COUPON_ISSUED_VIA_LABELS: Record<CouponIssuedVia, string> = {
  inbox: '對話發券',
  keyword: '關鍵字',
  follow: '加好友',
  automation: '自動化',
  broadcast: '廣播',
  batch: '批次發放',
  public_link: '公開領券',
  api: 'API',
};

/** 舊資料：workers 曾以觸發事件名稱當發放方式（例如 keyword.matched、message.received），不回填 */
const LEGACY_KEYWORD_EVENT = 'keyword.matched';

const isLegacyEventName = (issuedVia: string) => issuedVia.includes('.');

/** 用 hasOwn 而不是 in：`constructor`、`toString` 等原型上的名稱不能被當成代碼 */
const isKnownCode = (issuedVia: string): issuedVia is CouponIssuedVia => Object.hasOwn(COUPON_ISSUED_VIA_LABELS, issuedVia);

/**
 * 發放方式的顯示文字。舊資料的 `keyword.matched` 顯示「關鍵字」，其他含 `.` 的觸發事件名稱顯示「自動化」。
 * 沒有值或不認得的值回 undefined，由呼叫端決定（後台顯示「其他方式」）。
 */
export function couponIssuedViaLabel(issuedVia: string | null | undefined): string | undefined {
  if (!issuedVia) return undefined;
  if (isKnownCode(issuedVia)) return COUPON_ISSUED_VIA_LABELS[issuedVia];
  if (issuedVia === LEGACY_KEYWORD_EVENT) return COUPON_ISSUED_VIA_LABELS.keyword;
  if (isLegacyEventName(issuedVia)) return COUPON_ISSUED_VIA_LABELS.automation;
  return undefined;
}

/**
 * 系統保留的發放方式：只有系統自己的發券流程能寫入，發券 API 帶入時要拒絕（design D31）。
 * 除了 `api` 以外的代碼都是保留；舊的觸發事件名稱（含 `.`）會被顯示成「關鍵字」或「自動化」，也視為保留，
 * 否則整合程式可以冒用。
 */
export function isReservedCouponIssuedVia(issuedVia: string): boolean {
  if (issuedVia === COUPON_ISSUED_VIA.API) return false;
  return isKnownCode(issuedVia) || isLegacyEventName(issuedVia);
}
