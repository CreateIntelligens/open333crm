# Tasks: platform-core-mvp

## 1. 資料模型與 seed

- [x] 1.1 schema.prisma 新增 `PlatformUser`、`PlatformAuditLog`、`Plan`、`PlatformSetting` 全域表（註解「平台層全域資料，刻意不帶 tenantId」）＋ `Tenant.planId`（nullable FK）、`Tenant.limitOverrides`（Json @default("{}")）
- [x] 1.2 `prisma migrate dev` 產正式 migration（不可只 db push）＋ `prisma generate`
- [x] 1.3 seed：五方案 idempotent upsert（trial/light/standard/professional/enterprise，含四階 limits 與 trial 預設 features/limits）＋ dev 平台 superuser 帳號

## 2. 平台認證

- [x] 2.1 env.ts 加 `PLATFORM_JWT_SECRET`（optional）；auth.plugin.ts 新增 `authenticatePlatformSuperuser` decorator（獨立 secret 驗證，第四條認證路徑）
- [x] 2.2 `modules/platform/auth.routes.ts`：平台登入（bcrypt 驗證 PlatformUser、簽發平台 JWT TTL 2h、rate limit 10/min）；secret 未設時平台路由回 503
- [x] 2.3 `requirePlatformSuperuser()` guard；`PlatformAuditLog` 寫入 helper

## 3. Plan 與天花板

- [x] 3.1 `modules/platform/plan-limits.service.ts`：`getEffectiveLimit(tenant, key)`（override ?? plan.limits，null/無 plan=無上限）
- [x] 3.2 `permission.service.ts`：`getEffectivePermissions` 加天花板交集（registry feature→權限點展開 ∪ core；planId null 不交集）；快取 key 改 `perms:role:{roleId}:plan:{planId||'none'}`，改 plan 時失效該 plan pattern
- [x] 3.3 `agent.service.ts` createAgent 前置 maxAgents count 檢查 → `PLAN_LIMIT_EXCEEDED`（AppError 403，帶 limitKey/current/max）

## 4. 平台 API

- [x] 4.1 plans routes：GET 列表、PATCH 更新（features/limits/name/priceMonthly/isActive）＋快取失效＋稽核
- [x] 4.2 tenants routes：GET 列表（含 plan/trialEndsAt/isActive）、PATCH 停用/啟用、POST 手動開通（呼叫 provisionTenant + $transaction + 稽核；email 撞 409）
- [x] 4.3 settings routes：PlatformSetting KV GET/PUT（稽核）
- [x] 4.4 `provisionTenant()` service（收 TransactionClient；`seedRolesForTenant` 參數放寬型別）；index.ts 掛 `/api/v1/platform`

## 5. admin 前端骨架

- [x] 5.1 `app/admin/` layout + `PlatformAuthProvider`（獨立 token key）+ `/admin/login`
- [x] 5.2 `/admin/plans`：方案列表＋編輯（features 勾選、limits 數字/∞ 輸入）
- [x] 5.3 `/admin/tenants`：租戶列表＋停用/啟用＋手動開通表單

## 6. 驗證

- [x] 6.1 typecheck 全過
- [x] 6.2 隔離驗證：租戶 JWT 打平台 API 401、平台 JWT 打租戶 API 失敗、無 token 401
- [x] 6.3 天花板端到端：手動開通一個 trial 租戶 → 登入確認 sidebar 只見 trial features、被排除功能 API 403；planId null 的既有租戶行為不變（回歸）
- [x] 6.4 上限端到端：trial 租戶建到 maxAgents 上限被 PLAN_LIMIT_EXCEEDED 擋下；admin 後台改 limits 後立即生效
- [x] 6.5 開通回滾：模擬 email 撞 409，確認無孤兒 Tenant/roles
