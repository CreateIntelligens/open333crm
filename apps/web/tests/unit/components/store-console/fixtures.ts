/**
 * 核銷台元件測試共用的假資料與錯誤物件。
 * 錯誤物件模仿 axios：有 response 是後端回的錯誤；沒有 response 是網路錯誤。
 */
import type { LookupResponse, MeResponse, StoreCoupon, TodayResponse } from '#src/lib/store-console-api.js';

export function coupon(over: Partial<StoreCoupon> = {}): StoreCoupon {
  return {
    instanceId: 'i1',
    code: 'AUTUMN-R9XU-X9RG',
    name: '秋季回饋 滿千折百',
    couponType: 'DISCOUNT_AMOUNT',
    discountAmount: 100,
    discountPercent: null,
    minSpend: 1000,
    percentCap: null,
    giftName: null,
    giftQty: null,
    exchangeItem: null,
    exchangeValueCap: null,
    redeemMode: 'STAFF_SCAN',
    validityMode: 'FIXED',
    // 台灣時間 2026/10/01 00:00 – 2026/10/31 23:59
    startAt: '2026-09-30T16:00:00.000Z',
    endAt: '2026-10-31T15:59:00.000Z',
    expiresAt: null,
    customerName: '陳◯明',
    ...over,
  };
}

export function lookupOk(c: StoreCoupon = coupon()): LookupResponse {
  return { result: 'OK', coupon: c };
}

export function me(over: Partial<MeResponse['account']> = {}): MeResponse {
  return {
    account: { id: 'a1', username: 'dt3c-neihu', canRedeem: true, ...over },
    store: { id: 's1', name: '大同3C・內湖門市' },
  };
}

export function today(over: Partial<TodayResponse> = {}): TodayResponse {
  return {
    items: [],
    summary: { count: 0, discountTotal: 0, giftCount: 0, exchangeCount: 0 },
    date: '2026-10-06T16:00:00.000Z',
    ...over,
  };
}

export function apiError(status: number, code: string, details?: Record<string, unknown>, message = '錯誤') {
  return Object.assign(new Error(message), { response: { status, data: { success: false, error: { code, message, details } } } });
}

export function networkError() {
  return Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
}
