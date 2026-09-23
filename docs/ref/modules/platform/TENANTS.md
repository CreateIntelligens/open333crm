# 租戶管理

租戶的開通、停用與基本資料維護。開通邏輯由平台手動開通與試用自動開通共用。

- **資料來源**：`apps/api/src/modules/platform/platform-tenant.service.ts`
- **核對日期**：2026-09-23

`provisionTenant()` 是開通的核心，依序建立三樣東西：`Tenant`、系統角色、管理員 `Agent`。

這個函式收呼叫端提供的 transaction client，因此兩條開通路徑共用同一份邏輯：

| 路徑 | 呼叫者 | 差異 |
| --- | --- | --- |
| 平台手動開通 | `provisionTenantViaApi()`，平台路由呼叫 | 自行開 transaction |
| 試用自動開通 | `trial` 模組的 `trial.service.ts` | 與 token 消耗在同一個 transaction 內 |

密碼由呼叫端決定傳明文（函式內部 hash）或已 hash 的值。試用流程在申請時就已 bcrypt，開通時直接搬過來。

平台後台的共通機制（與租戶後台的隔離、快取連鎖、稽核、資料模型）見[平台後台](./README.md)。
