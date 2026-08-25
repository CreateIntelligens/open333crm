'use client';

import axios from 'axios';
import { API_BASE_URL } from '@/lib/constants';

// 平台後台專用 axios 實例。token 存 localStorage 獨立 key（與租戶登入完全分離）。
const TOKEN_KEY = 'platformToken';

export function getPlatformToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setPlatformToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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
platformApi.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && typeof window !== 'undefined') {
      setPlatformToken(null);
      if (!window.location.pathname.endsWith('/admin/login')) {
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(err);
  },
);
