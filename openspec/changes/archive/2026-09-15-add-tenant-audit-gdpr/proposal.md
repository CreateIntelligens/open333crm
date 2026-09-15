## Why

目前系統只有**平台層**稽核（`PlatformAuditLog`，供平台方查跨租戶的開通/停用/改 plan 動作），租戶內部的敏感操作（改設定、刪聯絡人、匯出名單、改角色權限、建/刪渠道等）**完全沒有留痕**，租戶 ADMIN 無法回答「是誰、在何時、對哪筆資料做了什麼」。同時，作為多租戶 SaaS，我們需要能回應歐盟 GDPR 的**資料可攜權（Art.20）**與**被遺忘權（Art.17）**——目前租戶既無法把自己的資料匯出帶走，也沒有合規的方式刪除/匿名化特定聯絡人的個資。這三塊是簽 SaaS 商用合約與進入受管制客戶（金融/醫療）前的合規基本盤。

## What Changes

- **新增租戶操作稽核（TenantAuditLog）**：新 model（`tenantId` scoped，與平台層 `PlatformAuditLog` 分離），記錄租戶內敏感操作（actor/action/targetType/targetId/payload）。提供 service helper `writeTenantAudit()`（比照現有 `writePlatformAudit()`），在敏感 route/service 呼叫點寫入；租戶 ADMIN 可透過後台 API 查詢（分頁 + 篩選 action/actor/日期）。
- **新增資料匯出能力（GDPR Art.20 可攜權）**：租戶可發起「匯出全部業務資料」（聯絡人/對話/案件/訊息等），非同步走 BullMQ worker 產生 zip（內含 JSON + CSV），存 MinIO，完成後以站內通知 + 一次性下載連結交付；匯出檔有保留期到期自動清除。
- **新增資料刪除能力（GDPR Art.17 被遺忘權）**：以**聯絡人**為粒度，租戶 ADMIN 可對指定聯絡人執行「匿名化」（預設，保留統計但抹除個資 PII）或「硬刪」（含其對話/案件/訊息連鎖）。動作非同步走 worker，過程與結果本身也寫進 TenantAuditLog（刪除這件事必須留痕）。
- **新增權限點**：`audit.view`（查稽核）、`data.export`（發起匯出/下載）、`data.erase`（發起刪除/匿名化），加入 `packages/core/src/rbac/permissions.ts` registry（feature: core）。
- **BREAKING**：無破壞性變更（純新增 model / 權限 / 路由，既有資料 `TenantAuditLog` 空、既有租戶不受影響）。

## Capabilities

### New Capabilities

- `tenant-audit-log`: 租戶層操作稽核——TenantAuditLog model、寫入 helper、哪些操作要記、租戶 ADMIN 查詢 API（分頁/篩選）與租戶隔離。
- `tenant-data-export`: 資料可攜（GDPR Art.20）——租戶自助匯出業務資料的請求生命週期、匯出範圍、非同步產檔（worker→MinIO）、一次性下載與檔案保留期。
- `tenant-data-erasure`: 被遺忘權（GDPR Art.17）——聯絡人層級的匿名化 / 硬刪流程、連鎖資料處理策略、不可復原性與稽核留痕。

### Modified Capabilities

- `rbac`: 權限點 registry 新增 `audit.view` / `data.export` / `data.erase` 三個 code（不改既有權限語意，僅擴充清單）。

## Impact

- **資料模型**：`packages/database/prisma/schema.prisma` 新增 `TenantAuditLog`、`DataExportRequest`、`DataErasureRequest` 三個 model（皆 `tenantId` scoped），需產正式 Prisma migration。
- **API**：`apps/api` 新增 `modules/tenant-audit`、`modules/data-export`、`modules/data-erasure`（routes + service），並在既有敏感 route/service（settings、contact delete、marketing export、role/permission、channel CRUD）加稽核寫入呼叫。
- **Workers**：`apps/workers` 新增 export / erasure 兩個 job consumer（Path B 非同步）。
- **儲存**：匯出 zip 存 `@open333crm/core` 的 MinIO provider（`packages/core/src/storage`）。
- **權限**：`packages/core/src/rbac/permissions.ts` 擴充（會影響 RBAC 設定頁與 role→permission 解析）。
- **協調**：與同期 `add-postgres-rls` change 協調——三個新表都是 `tenantId` scoped，必須一併納入 RLS policy 與 `scripts/check-tenant-scoping.mjs` 掃描白名單。
- **前端**：`apps/web` 需新增稽核查詢頁、匯出/刪除入口（本 change 聚焦後端能力，前端頁面於 tasks 標為後續）。
