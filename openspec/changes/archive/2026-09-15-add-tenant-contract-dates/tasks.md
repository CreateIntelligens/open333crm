## 1. Schema 與 Migration

- [ ] 1.1 `Tenant` model 加 `contractStartDate DateTime?` 與 `contractEndDate DateTime?`（nullable、無 default）
- [ ] 1.2 產正式 Prisma migration（`migrate dev --create-only` 後檢視 SQL 為 ADD COLUMN nullable、無破壞性），確認對既有租戶零影響
- [ ] 1.3 `prisma generate` 讓 client 型別更新

## 2. 後端 — 平台端點與驗證

- [ ] 2.1 在平台租戶服務（platform-tenant.service 或既有 trial-admin/租戶管理 service）加 `updateTenantContract(tenantId, { contractStartDate?, contractEndDate? })`
- [ ] 2.2 Zod schema：兩欄位 optional；兩者皆有值時 refine `contractEndDate >= contractStartDate`，否則 422
- [ ] 2.3 平台路由加 `PATCH /api/v1/platform/tenants/:id/contract`（或併入既有租戶 update 端點），受 `authenticatePlatformSuperuser` 保護
- [ ] 2.4 變更成功後寫 `PlatformAuditLog`（比照其他平台變更操作，帶 platformUserId 與前後值）
- [ ] 2.5 租戶列表／詳情查詢的 select 補回 `contractStartDate`／`contractEndDate`，供前端顯示
- [ ] 2.6 確認無租戶端（tenant JWT）端點可讀寫此兩欄位（僅平台 superuser 可存取）

## 3. 前端 — 平台後台租戶管理

- [ ] 3.1 `admin/tenants` 頁租戶列表／詳情顯示合約起訖日（未設定顯示為空）
- [ ] 3.2 加合約日期編輯 UI（日期選擇器，可只填其一或清空），呼叫 2.3 的端點
- [ ] 3.3 前端驗證迄日 >= 起日並友善呈現後端 422（`CONTRACT_DATE_INVALID` 之類）
- [ ] 3.4 platform-api 錯誤處理沿用既有慣例（401 攔截導 /admin/login 等）

## 4. 試用天數 UI 確認（不改行為）

- [ ] 4.1 確認平台後台（`admin/plans` 或試用政策設定頁）已可設定 `trial.durationDays`；若缺呈現則補上顯示與編輯
- [ ] 4.2 驗證改 `trial.durationDays` 不影響既有租戶 `trialEndsAt`（讀碼確認既有機制，不改動）

## 5. 驗證

- [ ] 5.1 typecheck（api + web）EXIT 0
- [ ] 5.2 端到端：平台設合約起訖日 → DB 持久化 + AuditLog；迄日<起日 → 422；只設起日 → 接受
- [ ] 5.3 確認合約到期不觸發任何自動行為（無 scheduler 掃 contract*、租戶不被停用）
- [ ] 5.4 確認租戶端無法存取合約日期（tenant JWT 打平台端點被擋）
- [ ] 5.5 更新 CHANGELOG.md（Added：平台層租戶合約日期記錄）
