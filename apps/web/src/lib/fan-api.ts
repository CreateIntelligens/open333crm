/**
 * 顧客端（票券夾）專用的 API client。
 *
 * 不可用 `@/lib/api`：那個實例收到 401 會呼叫 /auth/refresh、失敗就導回後台登入頁，
 * 而且會帶上座席的 token。顧客憑證存在 sessionStorage（關閉分頁即失效），
 * 401 時由頁面請顧客回到對話重新點選連結。
 */
import axios from 'axios';
import { API_BASE_URL } from './constants';

const TOKEN_KEY = 'fanCouponToken';
/** sessionStorage 被封鎖時的備援：這次瀏覽仍可用，重新整理後要重新點連結 */
let memoryToken: string | null = null;

export function getFanToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setFanToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 私密瀏覽或被封鎖儲存時：這次瀏覽仍可用（token 只存在記憶體），重新整理後要重新點連結
  }
}

const fanApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

fanApi.interceptors.request.use((config) => {
  const token = getFanToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default fanApi;
