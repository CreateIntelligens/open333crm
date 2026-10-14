import api from '@/lib/api';

export interface IdentityBindingStatus {
  /** 跨渠道綁定代碼 */
  enabled: boolean;
  /** email 登記（change add-email-identity-merge） */
  emailEnabled: boolean;
  /** 手機登記（change add-phone-identity-merge） */
  phoneEnabled: boolean;
}

// 切換對話不必每次重查（設定變更最多延遲 1 分鐘反映）
let cache: { value: IdentityBindingStatus; at: number } | null = null;

/** 租戶是否啟用跨渠道綁定、email 與手機登記（收件匣決定要不要顯示代發按鈕） */
export async function fetchIdentityBindingStatus(): Promise<IdentityBindingStatus> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const res = await api.get('/contacts/identity-binding/status');
  const data = res.data?.data;
  const value = { enabled: Boolean(data?.enabled), emailEnabled: Boolean(data?.emailEnabled), phoneEnabled: Boolean(data?.phoneEnabled) };
  cache = { value, at: Date.now() };
  return value;
}

/** 測試用：清除快取 */
export function resetIdentityBindingStatusCache(): void {
  cache = null;
}
