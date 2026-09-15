## 1. Schema 與 Migration

- [x] 1.1 `Tenant` model 加 `purgedAt DateTime?`（nullable、無 default）
- [x] 1.2 產正式 migration（ADD COLUMN nullable、非破壞性）
- [x] 1.3 `prisma generate`

## 2. 後端 — 軟刪排程

- [x] 2.1 `trial.scheduler.ts` 加軟刪分支：掃 `isActive=false` 且 `trialEndsAt` 距今 > `dataRetentionDays` 天 且 `purgedAt=null` 的試用租戶
- [x] 2.2 對符合者設 `purgedAt=now`，寫 `PlatformAuditLog`（platformUserId=null 系統動作，action 如 `tenant.trial.purge`）
- [x] 2.3 冪等：`purgedAt` 已有值者跳過；逐租戶 try/catch，單一失敗不影響其他
- [x] 2.4 保留期基準用 `trialEndsAt`（非停用時間），與 design 一致

## 3. 後端 — 復原與查詢

- [x] 3.1 平台租戶 service 加 `restorePurgedTenant(tenantId)`：清 `purgedAt=null`（不動 isActive），寫稽核
- [x] 3.2 平台路由加 `PATCH /platform/tenants/:id/restore`（platform superuser 保護）
- [x] 3.3 租戶列表／試用管理 select 補 `purgedAt`，供前端顯示軟刪狀態
- [x] 3.4 確認登入擋停用的邏輯已涵蓋軟刪租戶（因軟刪者必 isActive=false，現有邏輯已擋——讀碼確認，不需改）

## 4. 前端 — 平台後台

- [x] 4.1 租戶／試用管理頁顯示「已清除」狀態（purgedAt 非 null）
- [x] 4.2 對已軟刪租戶提供「復原」按鈕，呼叫 3.2 端點
- [x] 4.3 「資料保留天數」欄位維持可設（現已存在），確認其值現在真正生效（此 change 後）

## 5. 驗證

- [x] 5.1 typecheck（api + web）EXIT 0
- [x] 5.2 端到端／模擬：構造「停用 + trialEndsAt 超過保留期 + purgedAt null」租戶 → 跑軟刪邏輯 → `purgedAt` 被設 + 稽核；保留期未屆滿不軟刪；已軟刪不重複
- [x] 5.3 確認軟刪不真刪任何業務資料（軟刪後該租戶 contacts/cases 等仍在 DB）
- [x] 5.4 復原：清 purgedAt、isActive 維持 false、寫稽核
- [x] 5.5 軟刪租戶無法登入（比照 TENANT_DISABLED）
- [x] 5.6 更新 CHANGELOG.md（Added：試用租戶保留期屆滿軟刪 + 復原）
