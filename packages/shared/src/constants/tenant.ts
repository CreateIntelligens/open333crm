// 固定 Tenant UUID，僅供離線工具（seed / kb-ingest）當預設租戶使用。
// ⚠️ 請勿在登入或任何線上請求流程使用——登入已改為用 email 全域唯一解析租戶。
export const DEFAULT_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';
