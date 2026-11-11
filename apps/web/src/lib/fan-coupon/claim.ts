/**
 * 公開領券頁的資料（add-coupon-system design D30）。不需登入：不帶顧客憑證，也不用後台的 api 實例
 * （那個實例收到 401 會導回後台登入頁）。API 見 apps/api/src/modules/coupon/coupon-claim-public.routes.ts。
 */
import axios from 'axios';
import { API_BASE_URL } from '../constants';

export interface PublicClaimChannel {
  channelType: 'LINE' | 'FB' | 'THREADS';
  /** 公開帳號名稱（@xxxx、粉專 username）；沒有時為 null */
  publicName: string | null;
  /** LINE：先加入好友 */
  addFriendUrl?: string;
  /** LINE 為預填領券訊息的連結；FB／IG 為開啟對話的連結 */
  sendCodeUrl: string;
}

export interface PublicClaimPage {
  available: boolean;
  message: string | null;
  coupon: {
    name: string;
    description: string | null;
    imageUrl: string | null;
    couponType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT' | 'GIFT' | 'EXCHANGE' | null;
    discountAmount: number | null;
    discountPercent: number | null;
    percentCap: number | null;
    minSpend: number | null;
    giftName: string | null;
    giftQty: number | null;
    exchangeItem: string | null;
    validityMode: 'FIXED' | 'AFTER_CLAIM' | 'AFTER_OPEN' | null;
    startAt: string | null;
    endAt: string | null;
    afterClaimDays: number | null;
    afterOpenMinutes: number | null;
  };
  channel: PublicClaimChannel | null;
}

const publicApi = axios.create({ baseURL: API_BASE_URL });

/** 讀取領券頁資料；代碼不存在時 axios 丟出 404 */
export async function fetchPublicClaim(code: string): Promise<PublicClaimPage> {
  return (await publicApi.get(`/coupon-claim/${encodeURIComponent(code)}`)).data.data;
}
