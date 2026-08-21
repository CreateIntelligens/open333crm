## Why

目前系統是多租戶架構，但缺少「平台方」這一層——平台營運者無法控制每個租戶能用哪些功能、看不到跨租戶的用量與成本、無法對 AI token 設用量上限，AI API key 也寫死在後端 env 全平台共用。這使得 SaaS 化的三個核心能力都缺席：**方案分級（誰能用什麼）、用量計費（用了多少、值多少錢）、成本控管（超量擋、key 分租戶）**。

本 change 新增一個**平台控制平面（control plane）**：在既有租戶層（data plane）之上，讓平台 superuser 管理每個租戶的方案與額度、觀測用量與成本、代管或開放 AI key，並讓租戶在自己站台檢視方案/用量、自助選 key、申請升級加購。

> **依賴**：本 change 依賴 `rbac-granular-permissions`（租戶層 RBAC）。平台層的 entitlement 是租戶權限點的天花板，必須先有「權限點 + feature 對應」才能對應控制。詳見 design 的定義順序。

## What Changes

- **新增平台控制平面**：獨立認證路徑（平台 superuser，跨租戶身分，與租戶 JWT 完全分離）、獨立 `/admin` 前端與 `/api/v1/platform` API、平台稽核 log。租戶**永不登入平台層**。
- **Entitlement（租戶可用功能）**：以 feature module 為單位的 `Plan`（輕量版/標準版/專業版/企業版四階）+ 單租戶 override（加購/關閉）。有效權限 = 角色權限 ∩ entitlement 天花板（後端強制交集）。
- **數值上限參數化（plan-limits）**：客服人數、分眾標籤數、AI 額度等上限存 `Plan.limits`（+ 單租戶 `limitOverrides`），平台後台可改**非寫死**；達上限建立時硬擋。
- **Feature registry + 強制對應**：定義 feature module → 權限點對照，啟動驗證「每個權限點恰好歸屬一個 feature」，杜絕平台管不到的權限。
- **用量統計與計費**：跨租戶 + 單租戶的用量/計費/健康度三類指標與圖表；複用既有 `DailyStat`/`aggregateAllTenants` 骨架。
- **AI token 記錄（前置工程）**：現況 provider 介面層就丟棄 token，須從 `ChatProvider` 介面補起，新增 `AiUsage` 表逐次落地——這是計費、額度硬擋、成本統計的共同前提。
- **Per-tenant AI key + BYOK**：三層 fallback（租戶自填 → 平台代設 → env 預設）、多 provider 各自一把（加密 JSON）。BYOK 租戶成本不歸平台。
- **Token 額度硬擋**：平台可設每租戶 token 月額度；用量達上限即時硬擋 AI（Redis 即時計數器），需加購/升級恢復。
- **升級/加購流程**：租戶站內發起申請 → 平台後台審核核准 → 額度/方案即時生效（`PlanChangeRequest`）。
- **租戶端「方案與用量」頁**：租戶在自己 open333 站台唯讀檢視方案/功能/用量，自助選 AI key 來源，發起升級/加購。
- **改造既有 licenseService**：把「進程級 mock 單例」改成「依 tenant 查 DB plan」，複用 `requireFeature` guard。

## Capabilities

### New Capabilities
- `platform-auth`: 平台 superuser 認證路徑、`requirePlatformSuperuser` guard、與租戶認證的隔離、平台稽核 log。
- `tenant-entitlement`: Plan / feature override 資料模型、entitlement 解析、feature↔權限點對應與驗證、與租戶 RBAC 的天花板交集、快取失效鏈。
- `platform-usage`: AI token 記錄（AiUsage + provider 介面改造）、用量/計費/健康度指標彙總、跨租戶與單租戶統計 API、圖表資料契約。
- `ai-key-management`: per-tenant AI key 加密儲存、三層 fallback、BYOK、provider 收租戶 key、遮罩回應、平台代管與稽核。
- `token-quota`: 每租戶 token 月額度、Redis 即時計數器、超量硬擋、分級預警、BYOK 例外。
- `plan-limits`: 數值上限參數化（Plan.limits + Tenant.limitOverrides，平台後台可改非寫死）——客服人數、分眾標籤數等 count 型上限的建立時硬擋，null=無上限。
- `plan-change-request`: 升級/加購申請單、租戶發起、平台審核、核准後生效（改 plan / 提高額度 / 解除硬擋）。
- `tenant-billing-view`: 租戶站內方案與用量頁（唯讀 + AI key 自選 + 發起申請）的資料契約。

### Modified Capabilities
<!-- 平台層是全新能力，不修改既有 spec 的 requirement；與 rbac 的關係是依賴（feature 對應權限點），不是修改。 -->

## Impact

- **資料庫**：新增 `Plan`（全域）、`PlatformUser`（全域）、`PlatformAuditLog`（全域）、`AiUsage`、`AiModelPricing`（全域）、`PlanChangeRequest`；`Tenant` 加 `planId`/`featureOverrides`/`tokenQuotaMonthly`；`TenantSettings` 加 `aiKeysEncrypted`/`aiKeySource`。多支 migration。
- **後端**：`auth.plugin.ts` 加平台認證路徑；新 `modules/platform/`；`llm.service`/各 AI provider 改造（token 記錄 + 收租戶 key + 額度前置檢查）；`licenseService` per-tenant 化；抽出共用 crypto 工具。
- **前端**：新增 `apps/web/src/app/admin/`（平台後台，獨立認證）；租戶 `dashboard/` 加「方案與用量」頁。
- **快取（Redis）**：`entitlement:tenant:{id}`、`usage:tokens:{tenant}:{month}` 即時計數器。
- **前置依賴**：`rbac-granular-permissions`（權限點 registry + feature 標註）。
- **部署**：全域表為本 codebase 首見（現況僅 Tenant 全域），需明確標示；平台認證需獨立 secret。
