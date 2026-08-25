# Proposal: platform-core-mvp

## Why

免費試用站台（trial-signup）需要「功能、客服人數、token 額度可在平台層設定」的正式機制，但完整的 platform-control-plane（8 specs）範圍太大。本 change 從中切出 trial 直接依賴的最小子集先行落地：平台認證、Plan 資料層、上限硬擋、功能天花板交集、租戶開通 service。platform-control-plane 之後以 delta 補齊其餘 requirement（其 proposal 需註記 platform-auth / tenant-entitlement / plan-limits 的基礎已由本 change 交付）。

## What Changes

- **平台認證（platform-auth 全套）**：`PlatformUser` 全域表、平台登入 `/api/v1/platform/auth/login`（平台專屬 JWT，與租戶 JWT 完全分離的第四條認證路徑）、`requirePlatformSuperuser()` guard、`PlatformAuditLog` 稽核表、新模組 `apps/api/src/modules/platform/`。
- **Plan 資料層**：`Plan` 全域表（slug/name/features Json/limits Json/priceMonthly/isActive，刻意不帶 tenantId）、`Tenant.planId`（nullable FK）、`Tenant.limitOverrides`（Json）。Seed 五個方案 row：**trial**/light/standard/professional/enterprise（含 BD 四階 limits + trial 預設值）。
- **數值上限硬擋（plan-limits 最小版）**：有效上限 = `limitOverrides[key] ?? plan.limits[key]`（null=無上限；planId null=無上限，既有租戶不受影響）；`createAgent` 建立前 count 檢查 maxAgents，超限回 `PLAN_LIMIT_EXCEEDED`。
- **功能天花板交集（entitlement 最小版）**：`getEffectivePermissions()` 改為「角色權限 ∩ plan.features 展開的權限點天花板」——RBAC registry 每個權限點已帶 feature 欄位，展開即天花板；複用既有 Redis 權限快取與失效鏈，改 plan 時失效相關租戶。前端 sidebar / usePermission 因 `/me/permissions` 派生自動跟隨，不需前端改動。
- **租戶開通 service 化**：`provisionTenant()`（transaction：Tenant → `seedRolesForTenant` → admin Agent → 指派 plan → 稽核 log），並提供平台手動開通 API `POST /api/v1/platform/tenants`。trial-signup 的自動開通共用同一 service。
- **平台管理 API + 前端骨架**：plans 列表/更新（改 trial plan 的 features/limits 即「試用內容參數化」）、tenants 列表/停用、`PlatformSetting` KV 讀寫 API；`apps/web/src/app/admin/` 獨立 layout + 平台登入頁 + plans/tenants 最小管理頁。

**明確不做**（留給 platform-control-plane 後續）：licenseService 改造、用量儀表板、AI key/BYOK、Redis token 即時硬擋、plan-change-request、tenant-billing-view、feature registry 啟動驗證強化、nginx IP allowlist。

## Capabilities

### New Capabilities
- `platform-auth`: 平台 superuser 認證路徑、guard、PlatformUser/PlatformAuditLog 模型、平台 API 隔離。
- `tenant-plan`: Plan 全域資料模型、Tenant 關聯與 limitOverrides、功能天花板交集（有效權限 = 角色權限 ∩ plan features）、方案管理 API。
- `plan-limits-core`: 有效上限解析與 maxAgents 建立時硬擋、PLAN_LIMIT_EXCEEDED 錯誤契約。
- `tenant-provisioning`: provisionTenant() 開通 transaction 與平台手動開通 API。

### Modified Capabilities
（無——`rbac` 既有 spec 的權限解析行為由天花板「收窄」，但無 plan 時行為完全不變，屬新增約束而非改既有 requirement，以 `tenant-plan` 的 ADDED requirement 表達。）

## Impact

- **DB**：schema.prisma 新增 `PlatformUser`、`PlatformAuditLog`、`Plan`、`PlatformSetting`；`Tenant` 加 `planId`、`limitOverrides`。**必須產正式 Prisma migration**。seed 補五方案 + 一個 platform superuser（dev 用）。
- **API**：新模組 `apps/api/src/modules/platform/`（auth/plans/tenants/settings routes + services）；`auth.plugin.ts` 增平台 JWT 驗證路徑；`permission.service.ts` 加天花板交集；`agent.service.ts` createAgent 前加 maxAgents 檢查；`index.ts` 掛路由。
- **前端**：`apps/web/src/app/admin/`（獨立 layout，不共用租戶 dashboard）＋平台登入＋ plans/tenants 頁。
- **依賴前提**：`feat/rbac-granular-permissions` 分支（permission.service、RBAC registry、seedRolesForTenant）需先合併。
- 無 socket 事件、無 workers 變更、無新套件。
