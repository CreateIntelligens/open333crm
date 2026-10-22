/**
 * 店員核銷台（/redeem）專用的 API client。
 *
 * 不可用 `@/lib/api`：那個實例會帶座席的 token，收到 401 時還會呼叫 /auth/refresh、
 * 失敗就導回後台登入頁。核銷台以門市帳號登入（design D13），用自己的門市憑證，
 * 帳號錯誤由核銷台依錯誤碼顯示對應的說明卡。
 *
 * 門市憑證：勾選「保持登入」存 localStorage（30 天），否則存 sessionStorage（關閉分頁即失效）。
 */
import axios from 'axios';
import { API_BASE_URL } from './constants';

const TOKEN_KEY = 'storeConsoleToken';

function storages(): { local: Storage | null; session: Storage | null } {
  if (typeof window === 'undefined') return { local: null, session: null };
  let local: Storage | null = null;
  let session: Storage | null = null;
  try {
    local = window.localStorage;
  } catch {
    // 私密瀏覽或封鎖網站資料時，存取 localStorage 會丟例外
  }
  try {
    session = window.sessionStorage;
  } catch {
    // 同上
  }
  return { local, session };
}

/** 記憶體備援：兩種儲存都不能用時，這次瀏覽仍可使用，重新整理後要重新登入 */
let memoryToken: string | null = null;

export function getStoreToken(): string | null {
  const { local, session } = storages();
  try {
    const fromLocal = local?.getItem(TOKEN_KEY);
    if (fromLocal) return fromLocal;
  } catch {
    // 讀不到就試下一個
  }
  try {
    const fromSession = session?.getItem(TOKEN_KEY);
    if (fromSession) return fromSession;
  } catch {
    // 讀不到就用記憶體中的
  }
  return memoryToken;
}

export function setStoreToken(token: string, remember: boolean): void {
  memoryToken = token;
  const { local, session } = storages();
  const [keep, drop] = remember ? [local, session] : [session, local];
  try {
    drop?.removeItem(TOKEN_KEY);
  } catch {
    // 忽略：清不掉的舊憑證會在下次登入時被覆蓋
  }
  try {
    keep?.setItem(TOKEN_KEY, token);
  } catch {
    // 寫不進去時只保留在記憶體
  }
}

export function clearStoreToken(): void {
  memoryToken = null;
  const { local, session } = storages();
  for (const s of [local, session]) {
    try {
      s?.removeItem(TOKEN_KEY);
    } catch {
      // 忽略
    }
  }
}

const storeApi = axios.create({
  baseURL: `${API_BASE_URL}/store-console`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

storeApi.interceptors.request.use((config) => {
  const token = getStoreToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── 型別 ──────────────────────────────────────────────────────────────────

export type StoreCouponType = 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE';

/** 核銷台看到的券（後端 StoreCouponView；日期為 ISO 字串） */
export interface StoreCoupon {
  instanceId: string;
  code: string;
  name: string;
  couponType: StoreCouponType | string | null;
  discountAmount: number | null;
  /** 折掉幾 %：15 表示 85 折 */
  discountPercent: number | null;
  minSpend: number | null;
  percentCap: number | null;
  giftName: string | null;
  giftQty: number | null;
  exchangeItem: string | null;
  exchangeValueCap: number | null;
  redeemMode: string | null;
  validityMode: string | null;
  startAt: string | null;
  endAt: string | null;
  expiresAt: string | null;
  /** 已遮罩的顧客名稱，例「陳◯明」 */
  customerName: string;
}

/** SHARED_CODE：輸入的是共用碼券的共用券號，分不出是哪一位顧客 */
export type LookupResult = 'OK' | 'USED' | 'EXPIRED' | 'NOT_YET' | 'ENDED' | 'WRONG_MODE' | 'NOT_CLAIMED' | 'NOT_FOUND' | 'SHARED_CODE';

export interface LookupResponse {
  result: LookupResult;
  coupon?: StoreCoupon;
  redeemedAt?: string;
  redeemedStoreName?: string | null;
  expiresAt?: string;
  availableAt?: string;
}

export type RedeemFailureReason =
  | 'NOT_FOUND'
  | 'ALREADY_REDEEMED'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'REVOKED'
  | 'WRONG_MODE'
  | 'NOT_CLAIMED'
  | 'NOT_OPENED'
  | 'SHARED_CODE'
  | 'KEY_REUSED';

export type RedeemResponse =
  | { ok: true; redeemedAt: string; storeName: string; coupon: StoreCoupon }
  | { ok: false; reason: RedeemFailureReason; coupon?: StoreCoupon; redeemedAt?: string; redeemedStoreName?: string | null };

export interface LoginResponse {
  token: string;
  storeName: string;
  username: string;
  canRedeem: boolean;
}

export interface MeResponse {
  account: { id: string; username: string; canRedeem: boolean };
  store: { id: string; name: string };
}

export interface TodayItem extends StoreCoupon {
  redeemedAt: string;
}

export interface TodayResponse {
  items: TodayItem[];
  summary: { count: number; discountTotal: number; giftCount: number; exchangeCount: number };
  /** 台灣時間今天 00:00 的時間點 */
  date: string;
}

// ── 端點 ──────────────────────────────────────────────────────────────────

export async function storeLogin(body: { username: string; password: string; remember: boolean }): Promise<LoginResponse> {
  return (await storeApi.post('/login', body)).data.data;
}

/** 登入頁依網址 ?store= 顯示門市名稱（不需登入） */
export async function getStoreName(storeId: string): Promise<string> {
  return (await storeApi.get(`/stores/${encodeURIComponent(storeId)}`)).data.data.name;
}

export async function getMe(): Promise<MeResponse> {
  return (await storeApi.get('/me')).data.data;
}

/** 查券：只讀，不改變券的狀態 */
export async function lookupCoupon(code: string): Promise<LookupResponse> {
  return (await storeApi.get('/lookup', { params: { code } })).data.data;
}

/** 確認核銷。key 為每次按「確認核銷」產生的重試鍵；網路錯誤時用同一個 key 重送 */
export async function redeemCoupon(code: string, key: string): Promise<RedeemResponse> {
  return (await storeApi.post('/redeem', { code, key })).data.data;
}

export async function getToday(): Promise<TodayResponse> {
  return (await storeApi.get('/today')).data.data;
}

export default storeApi;
