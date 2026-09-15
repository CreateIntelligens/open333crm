# Design: platform-core-mvp

## Context

- 完整平台層設計已在 `openspec/changes/platform-control-plane/design-notes/`（ARCH-PLATFORM-LAYER.md 等 6 份）定案；本 change 是其最小可交付子集，設計決策沿用該處，此處只記「切法」與落地細節。
- 依賴 `feat/rbac-granular-permissions` 分支：`packages/core/src/rbac/` registry（49 權限點，各帶 feature 欄位、8 個 feature module）、`permission.service.ts`（有效權限 + Redis 快取 `perms:role:{roleId}` TTL 10min）、`seedRolesForTenant()` helper（尚無呼叫端）。
- 既有認證：`auth.plugin.ts` 以 token 前綴分派三條路徑（JWT / `pk_` Partner / `cli_` CLI）。

## Goals / Non-Goals

**Goals:**
- trial-signup 所需的四塊基礎：平台認證、Plan 資料層＋功能天花板、maxAgents 硬擋、開通 service。
- 既有租戶零影響：planId null = 無天花板、無上限。
- 平台改 plan（features/limits）即時生效於該方案所有租戶，零改碼。

**Non-Goals:**
- 不做用量統計、AI key、Redis 額度計數器、plan-change-request、licenseService 改造（platform-control-plane 後續 delta）。
- 不做 maxTags 硬擋（trial 不急需；plan-limits 完整版補）。
- admin 前端只做最小可操作版（表單＋列表），不做 dashboard 視覺。

## Decisions

### D1. 平台 JWT 用獨立 secret + issuer claim，不用 `psk_` opaque token
ARCH design-note §7 待拍板項，此處定案：平台登入簽發 JWT（payload `{ platformUserId, role: 'PLATFORM_SUPERUSER' }`，`PLATFORM_JWT_SECRET` 獨立 env，TTL 短（2h）＋不做 refresh（後台工具容忍重登）。`auth.plugin.ts` 新增 `authenticatePlatformSuperuser` decorator，只驗平台 secret——租戶 JWT 用租戶 secret 簽發，兩把 key 互簽不過，隔離在密碼學層。
- 為什麼不用 opaque `psk_`：JWT 與既有 fastify-jwt 基礎一致、無需新 session 表；IP allowlist 縱深防禦留待上線前。

### D2. 天花板交集做在 `getEffectivePermissions()` 單點
`effective = rolePerms(roleId) ∩ ceilingPerms(tenant.planId)`；`ceilingPerms` = registry 中 feature ∈ plan.features 的權限點集合 ∪ core feature 權限點（core 恆開）。
- planId null → 不交集（全放行），既有租戶與 UAT 資料零影響。
- 快取：既有 `perms:role:{roleId}` 快取的是角色權限，交集後結果與 tenant 相關 → 快取 key 改為 `perms:role:{roleId}:plan:{planId||'none'}`（同 change 內一併改），改 plan 的 features 時 `invalidateByPlan(planId)`（scan 該 plan pattern 或直接短 TTL 靠過期，取簡單版：改 plan 時刪 `perms:*:plan:{planId}`）。
- guard（requirePermission）與前端 `/me/permissions` 零改動——交集發生在最底層。

### D3. Plan / PlatformSetting 為全域表，效仿既有唯一先例 Tenant
schema 註解明確標「平台層全域資料，刻意不帶 tenantId」。`Plan.limits` Json（maxAgents/maxTags/monthlyTokens，null=無上限），有效上限 helper `getEffectiveLimit(tenant, key)` 放 `modules/platform/plan-limits.service.ts`，供 createAgent（本 change）與 trial token 檢查（trial-signup change）共用。

### D4. provisionTenant() 收 `Prisma.TransactionClient`
`provisionTenant(tx, { name, planSlug, admin: { email, name, passwordHash }, trialEndsAt? })` → tenant.create → `seedRolesForTenant(tx, tenantId)`（參數型別由 PrismaClient 放寬為 TransactionClient，介面相容）→ agent.create（ADMIN + roleId 雙寫，沿用 agent.service 的 resolveRoleId 邏輯）→ 回傳 { tenantId, adminAgentId }。呼叫端自帶 $transaction 與稽核寫入——trial-signup 的驗證消耗需與開通同 transaction，所以 service 本身不開 transaction。

### D5. maxAgents 硬擋放 agent.service.createAgent 前置
`count(agent where tenantId, isActive:true) >= getEffectiveLimit(tenant,'maxAgents')` → throw `AppError('PLAN_LIMIT_EXCEEDED', …, 403)`，payload 帶 `{ limitKey, current, max }`。硬擋在權限檢查之後、建立之前（正交於 RBAC，對齊 plan-limits spec）。

### D6. admin 前端獨立 layout，不掛租戶 AuthProvider
`apps/web/src/app/admin/` 自有 layout + `PlatformAuthProvider`（平台 JWT 存 localStorage 獨立 key），與租戶 dashboard 完全分離；未登入導 `/admin/login`。頁面：plans（列表＋編輯 features 勾選與 limits 數字/∞）、tenants（列表＋停用/啟用＋手動開通表單）、settings（PlatformSetting KV，trial-signup 用）。

## Risks / Trade-offs

- [快取 key 改版造成短暫全 miss] → 一次性、10min TTL 自然回填；部署時無需清 Redis。
- [平台 secret 未設時平台路由不可用] → env optional＋路由註冊時檢查，未設定則回 503 並 log 明確訊息（不擋 API 其他功能啟動）。
- [planId 回填策略] → 既有租戶維持 null（無限制），要納管時平台後台手動指派；不做自動 backfill，避免意外收窄現網權限。
- [admin 頁走同一 web app 增加 bundle] → App Router 路由層級 code-split，影響可忽略。

## Migration Plan

1. migration：PlatformUser/PlatformAuditLog/Plan/PlatformSetting + Tenant.planId/limitOverrides（一支 migration）。
2. seed：五方案 upsert（idempotent）＋ dev 平台帳號（prod 由手動 SQL/腳本建）。
3. 程式與 migration 同 PR；planId null 語意保證舊資料零影響。回滾 revert 程式即可。

## Open Questions

- 無阻塞。（PLATFORM_JWT_SECRET 的 prod 值由部署時產生；nginx allowlist 上線前另補。）
