## Why

平台方（superuser）目前對付費租戶「沒有合約期間的記錄」——`Tenant` 只有 `trialEndsAt`（試用到期，會觸發自動停用），但正式合約的起訖日無處可存、無處可查。BD/營運需要在平台後台看到「這個租戶的合約從哪天到哪天」以利續約提醒、對帳與客戶溝通，這是純記錄需求（不改變任何自動化行為）。同時把既有的免費試用天數設定（`trial.durationDays`）在平台後台的呈現一併確認完整，讓「租戶期間管理」在同一處清楚可見。

## What Changes

- `Tenant` 新增兩個 nullable 欄位：`contractStartDate`、`contractEndDate`（`DateTime?`），純記錄合約起訖日。
- 平台後台租戶管理頁可**設定與顯示**每個租戶的合約起訖日（平台 superuser 專用）。
- 合約日期為**純記錄**：MUST NOT 觸發自動停用、提醒或任何生命週期行為（與 `trialEndsAt` 的到期自動停用明確區隔）。
- 確認既有 `trial.durationDays`（免費試用天數，存 `PlatformSetting`、平台後台可改、開通時算 `trialEndsAt`）在平台後台 UI 呈現完整；此機制**不改動行為**，僅納入「租戶期間管理」規格一併呈現。
- 新增 migration 加上述兩欄位（nullable、無 default，對既有租戶零影響）。

## Capabilities

### New Capabilities
- `tenant-contract-dates`: 平台層為租戶記錄與管理合約起訖日（純記錄，不含自動生命週期）；並涵蓋「試用天數（trial.durationDays）在平台後台的設定與呈現」的確認性需求。

### Modified Capabilities
<!-- 無：trial.durationDays 的行為不變（已由 trial-signup 的 trial-lifecycle 規格涵蓋），本 change 僅新增合約日期能力並確認 UI，不改動既有 requirement。 -->

## Impact

- **Schema / DB**：`packages/database/prisma/schema.prisma` 的 `Tenant` model 加 `contractStartDate`/`contractEndDate`；新增一支 migration。
- **後端**：平台租戶服務（`apps/api/src/modules/platform/platform-tenant.service.ts` 或既有租戶管理 service）新增讀寫合約日期；平台路由（`platform.routes.ts`）加對應端點（受 `authenticatePlatformSuperuser` 保護）。
- **前端**：平台後台租戶管理頁（`apps/web/src/app/admin/tenants/page.tsx`）加合約起訖日的顯示與編輯 UI；順帶確認方案/試用天數（`admin/plans` 或試用政策頁）的 `trial.durationDays` 呈現。
- **無破壞性**：欄位 nullable、既有租戶不受影響；不改動 trial/停用等既有自動化。
- **依賴**：屬 `platform-control-plane` 延伸，複用既有平台認證（`platform-auth`）與租戶管理機制。
