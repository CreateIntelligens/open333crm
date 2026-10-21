/**
 * 對話發券（add-coupon-system A11）：API 呼叫、型別與文案。
 * 後端路由在 /api/v1/coupon-issue（apps/api/src/modules/coupon/coupon-inbox.routes.ts）。
 */
import api from '@/lib/api';
import { getApiErrorCode, getApiErrorDetails } from '@/lib/api-error';
import { pad2, taipeiParts } from '@/lib/taipei-time';

export type IssuedStatus = 'SENT' | 'VIEWED' | 'USED' | 'EXPIRED' | 'REVOKED';

export interface IssuableCoupon {
  id: string;
  name: string;
  couponType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE' | null;
  discountAmount: number | null;
  discountPercent: number | null;
  percentCap: number | null;
  giftName: string | null;
  giftQty: number | null;
  exchangeItem: string | null;
  minSpend: number | null;
  validityMode: 'FIXED' | 'AFTER_CLAIM' | 'AFTER_OPEN' | null;
  startAt: string | null;
  endAt: string | null;
  afterClaimDays: number | null;
  afterOpenMinutes: number | null;
  perContactLimit: number;
  receivedCount: number;
  limitReached: boolean;
  lastClaimedAt: string | null;
  lastRedeemedAt: string | null;
  expiringAt: string | null;
  drivesSpend: boolean;
}

export interface IssueContext {
  conversation: {
    id: string;
    status: string;
    assignedToId: string | null;
    contactId: string;
    contactName: string;
    channelType: string;
  };
  blocked: { reason: 'CONVERSATION_CLOSED' | 'BOT_HANDLED' | 'REPLY_WINDOW_EXPIRED'; windowHours?: number } | null;
  history: {
    count: number;
    totalAmount: number;
    latest: { couponName: string; issuedByName: string | null; issuedAt: string; status: IssuedStatus } | null;
  };
  coupons: IssuableCoupon[];
}

export interface IssuedCoupon {
  id: string;
  couponId: string;
  couponName: string;
  couponType: IssuableCoupon['couponType'];
  discountAmount: number | null;
  discountPercent: number | null;
  giftName: string | null;
  exchangeItem: string | null;
  issuedByName: string | null;
  issuedSourceName: string | null;
  issuedAt: string;
  status: IssuedStatus;
}

export interface IssueSuccess {
  instanceId: string;
  code: string;
  couponId: string;
  couponName: string;
  messageId: string;
}

/** 對話訊息 content.coupon：後台畫成券卡 */
export interface CouponMessageContent {
  instanceId: string;
  couponId: string;
  name: string;
  couponType: IssuableCoupon['couponType'];
  discountAmount: number | null;
  discountPercent: number | null;
  giftName: string | null;
  exchangeItem: string | null;
  minSpend: number | null;
  expiresAt: string | null;
  issuedByName: string | null;
}

export const issueContextKey = (conversationId: string) => `/coupon-issue/conversations/${conversationId}`;
export const issuedCouponsKey = (conversationId: string) => `/coupon-issue/conversations/${conversationId}/issued`;

export async function fetchIssueContext(conversationId: string): Promise<IssueContext> {
  const res = await api.get(issueContextKey(conversationId));
  return res.data.data;
}

/** 發券請求逾時：超過就改查發送結果，不重送 */
export const ISSUE_TIMEOUT_MS = 15_000;

export async function issueCoupon(
  conversationId: string,
  body: { couponId: string; requestKey: string; expectedAssigneeId: string | null },
): Promise<IssueSuccess> {
  const res = await api.post(`/coupon-issue/conversations/${conversationId}`, body, { timeout: ISSUE_TIMEOUT_MS });
  return res.data.data;
}

export type IssueRequestState =
  | { state: 'pending' }
  | { state: 'unknown' }
  | { state: 'done'; result: ({ ok: true } & IssueSuccess) | { ok: false; reason: string; details?: { issuedByName?: string | null } } };

export async function fetchIssueRequest(requestKey: string): Promise<IssueRequestState> {
  const res = await api.get(`/coupon-issue/requests/${requestKey}`);
  return res.data.data;
}

// ── 文案 ───────────────────────────────────────────────────────────────────

const nt = (n: number) => `NT$${n.toLocaleString('zh-TW')}`;

/** MM/DD */
export function md(value: string | null | undefined): string {
  const d = taipeiParts(value);
  return d ? `${pad2(d.month)}/${pad2(d.day)}` : '';
}

/** YYYY/MM/DD */
export function ymd(value: string | Date | null | undefined): string {
  const d = taipeiParts(value);
  return d ? `${d.year}/${pad2(d.month)}/${pad2(d.day)}` : '';
}

/** MM/DD HH:mm */
export function mdhm(value: string | null | undefined): string {
  const d = taipeiParts(value);
  return d ? `${md(value)} ${pad2(d.hour)}:${pad2(d.minute)}` : '';
}

type FaceFields = Pick<IssuableCoupon, 'couponType' | 'discountAmount' | 'discountPercent' | 'giftName' | 'exchangeItem'>;

/** 卡片左側的大字面額：$100、85 折、贈品、兌換 */
export function faceShort(c: FaceFields): string {
  switch (c.couponType) {
    case 'DISCOUNT_AMOUNT':
      return c.discountAmount ? `$${c.discountAmount.toLocaleString('zh-TW')}` : '折抵';
    case 'DISCOUNT_PERCENT':
      return c.discountPercent ? `${100 - c.discountPercent} 折` : '折扣';
    case 'GIFT':
      return '贈品';
    case 'EXCHANGE':
      return '兌換';
    default:
      return '優惠';
  }
}

/** 文字面額：NT$100、85 折、贈品 濾網、兌換 清洗服務 */
export function faceText(c: FaceFields): string {
  switch (c.couponType) {
    case 'DISCOUNT_AMOUNT':
      return c.discountAmount ? nt(c.discountAmount) : '元折抵';
    case 'DISCOUNT_PERCENT':
      return c.discountPercent ? `${100 - c.discountPercent} 折` : '% 折扣';
    case 'GIFT':
      return c.giftName ? `贈品 ${c.giftName}` : '贈品';
    case 'EXCHANGE':
      return c.exchangeItem ? `兌換 ${c.exchangeItem}` : '兌換';
    default:
      return '';
  }
}

/** 選券清單的效期：有效 30 天、有效至 11/19、開啟後 15 分鐘 */
export function validityShort(c: Pick<IssuableCoupon, 'validityMode' | 'endAt' | 'afterClaimDays' | 'afterOpenMinutes'>): string {
  switch (c.validityMode) {
    case 'FIXED':
      return c.endAt ? `有效至 ${ymd(c.endAt)}` : '';
    case 'AFTER_CLAIM':
      return c.afterClaimDays ? `有效 ${c.afterClaimDays} 天` : '';
    case 'AFTER_OPEN':
      return c.afterOpenMinutes ? `開啟後 ${c.afterOpenMinutes} 分鐘內使用` : '';
    default:
      return '';
  }
}

/** 確認畫面的有效期：固定效期寫到期日；領取後 N 天以今天起算 */
export function validityOnConfirm(
  c: Pick<IssuableCoupon, 'validityMode' | 'endAt' | 'afterClaimDays' | 'afterOpenMinutes'>,
  now: Date = new Date(),
): string {
  switch (c.validityMode) {
    case 'FIXED':
      return c.endAt ? `至 ${ymd(c.endAt)}` : '—';
    case 'AFTER_CLAIM':
      return c.afterClaimDays
        ? `發送後 ${c.afterClaimDays} 天（至 ${ymd(new Date(now.getTime() + c.afterClaimDays * 86_400_000))}）`
        : '—';
    case 'AFTER_OPEN':
      return c.afterOpenMinutes ? `顧客開啟後 ${c.afterOpenMinutes} 分鐘內使用` : '—';
    default:
      return '—';
  }
}

/** 選券清單的說明列：有效 30 天 · 每人限 1 張 · 此顧客已領 0 · 滿 NT$1,000 可用 */
export function couponMeta(c: IssuableCoupon): string {
  return [
    validityShort(c),
    `每人限 ${c.perContactLimit} 張`,
    `此顧客已領 ${c.receivedCount}`,
    c.minSpend ? `滿 ${nt(c.minSpend)} 可用` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 已達上限的說明：此顧客已於 09/20 領取，09/22 已使用 */
export function limitReachedText(c: IssuableCoupon): string {
  const claimed = c.lastClaimedAt ? `此顧客已於 ${md(c.lastClaimedAt)} 領取` : '此顧客已達每人上限';
  return c.lastRedeemedAt ? `${claimed}，${md(c.lastRedeemedAt)} 已使用` : claimed;
}

export const ISSUED_STATUS_LABEL: Record<IssuedStatus, string> = {
  SENT: '已發送',
  VIEWED: '已領取',
  USED: '已使用',
  EXPIRED: '已過期',
  REVOKED: '已作廢',
};

// ── 失敗 ───────────────────────────────────────────────────────────────────

export interface IssueFailure {
  /** 錯誤碼；NETWORK 表示沒有收到回應，結果不明 */
  code: string;
  message: string;
  /** 券是否已發出的說明 */
  outcome: string;
}

/** 依錯誤碼組成座席看到的原因與「券是否已發出」（UX 規格「發送失敗」表） */
export function describeIssueFailure(code: string, details?: { issuedByName?: string | null }, fallback?: string): IssueFailure {
  switch (code) {
    case 'COUPON_NOT_ISSUABLE':
      return { code, message: '此券已停止發放，並重新整理券清單', outcome: '這次的券未發出。' };
    case 'PER_CONTACT_LIMIT_REACHED':
      return {
        code,
        message: details?.issuedByName
          ? `此顧客剛剛已由 ${details.issuedByName} 領取，已達每人上限`
          : '此顧客已達每人上限',
        outcome: '這次的券未發出。',
      };
    case 'COUPON_DELIVERY_FAILED':
      return { code, message: '顧客目前無法接收訊息，券未發出', outcome: '這次的券未發出。' };
    case 'CONVERSATION_OUT_OF_SCOPE':
      return { code, message: '此對話已不在你的處理範圍', outcome: '這次的券未發出。' };
    case 'CONVERSATION_BOT_HANDLED':
      return { code, message: '機器人處理中，請先接手對話再發券', outcome: '這次的券未發出。' };
    case 'REPLY_WINDOW_EXPIRED':
      return { code, message: '已超過回覆期限，無法發送優惠券', outcome: '這次的券未發出。' };
    default:
      return { code, message: fallback ?? '發券失敗', outcome: '這次的券未發出，可以重新發送。' };
  }
}

/** 從 API 錯誤取出錯誤碼與 details；沒有回應（逾時、斷線）回傳 NETWORK */
export function issueErrorOf(err: unknown): { code: string; details?: { issuedByName?: string | null } } {
  const hasResponse = Boolean((err as { response?: unknown })?.response);
  if (!hasResponse) return { code: 'NETWORK' };
  return {
    code: getApiErrorCode(err) ?? 'UNKNOWN',
    details: getApiErrorDetails(err) as { issuedByName?: string | null } | undefined,
  };
}
