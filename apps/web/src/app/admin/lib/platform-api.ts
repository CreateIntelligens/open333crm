'use client';

import axios from 'axios';
import { API_BASE_URL } from '@/lib/constants';

// 平台後台專用 axios 實例。token 存 localStorage 獨立 key（與租戶登入完全分離）。
const TOKEN_KEY = 'platformToken';
const MUST_CHANGE_PASSWORD_KEY = 'platformMustChangePassword';

export function getPlatformToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setPlatformToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
  }
}

/** 登入時（或 mustChangePassword 相關操作後）同步此旗標，供 layout 判斷是否強制導向改密碼頁。 */
export function getMustChangePassword(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(MUST_CHANGE_PASSWORD_KEY) === '1';
}
export function setMustChangePassword(value: boolean): void {
  if (typeof window === 'undefined') return;
  if (value) localStorage.setItem(MUST_CHANGE_PASSWORD_KEY, '1');
  else localStorage.removeItem(MUST_CHANGE_PASSWORD_KEY);
}

export const platformApi = axios.create({
  baseURL: `${API_BASE_URL}/platform`,
  headers: { 'Content-Type': 'application/json' },
});

platformApi.interceptors.request.use((config) => {
  const token = getPlatformToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// token 過期/失效（401）→ 清 token 並導回登入頁，避免靜默失敗顯示空資料
// mustChangePassword 帳號呼叫非改密碼 API（403 MUST_CHANGE_PASSWORD）→ 強制導向改密碼頁
platformApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window === 'undefined') return Promise.reject(err);
    if (err?.response?.status === 401) {
      setPlatformToken(null);
      if (!window.location.pathname.endsWith('/admin/login')) {
        window.location.href = '/admin/login';
      }
    } else if (err?.response?.data?.error?.code === 'MUST_CHANGE_PASSWORD') {
      setMustChangePassword(true);
      if (!window.location.pathname.endsWith('/admin/change-password')) {
        window.location.href = '/admin/change-password?forced=1';
      }
    }
    return Promise.reject(err);
  },
);
