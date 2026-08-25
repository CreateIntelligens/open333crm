## Context

在既有多租戶 CRM（`apps/api` Fastify + `apps/web` Next.js + Prisma/PG + Redis）之上，新增平台控制平面。關鍵 codebase 現況（實查）：

- 已有 `licenseService`（`apps/api/src/services/license.ts`）feature/credits 雛型 + `requireFeature` guard，但為「進程級 mock 單例、單一 license」——平台層本質是把它 per-tenant 化 + 落 DB。
- `auth.plugin.ts` 已用 token 前綴分派三條認證路徑（JWT / `pk_` Partner / `cli_` CLI）——平台認證照抄成第四條。
- **AI token 目前 100% 沒記錄**（`ChatProvider.generate()` 回 `Promise<string>`，介面層就丟棄）——計費與硬擋的共同前置工程。
- 無通用稽核表（`CaseEvent` 是既有「誰對什麼做了什麼」範式）；無全域業務表（僅 `Tenant` 全域）。
- 合法跨租戶樣式已存在（`sla.handler.ts` 全域查詢 + 逐 row tenantId 分派）。

完整設計分六份保留在 `design-notes/`：`SPEC-PLATFORM-LAYER`（entitlement）、`ARCH-PLATFORM-LAYER`（架構總綱）、`SPEC-PLATFORM-USAGE`（用量統計）、`SPEC-PLATFORM-AI-KEY`（key）、`SPEC-PLATFORM-QUOTA-BILLING`（額度硬擋+加購）、`SPEC-PLATFORM-TENANT-VIEW`（租戶端頁）。本 design 為跨文件決策總綱。

## Goals / Non-Goals

**Goals:**
- 平台方可控制每租戶方案/額度、觀測跨租戶用量成本、管理 AI key，且與租戶資料嚴格隔離。
- 租戶不登入平台層；在自己站台唯讀檢視 + 自助選 key + 發起申請。
- 有效權限 = 角色權限 ∩ entitlement 天花板（後端強制）。
- AI token 可記錄、可計費、可即時硬擋。

**Non-Goals:**
- 不接金流（升級/加購為人工審核，`Plan` 預留價格欄位不接付款）。
- 不做租戶自助開通（tenant 建立仍由平台方發起）。
- 不改租戶層 RBAC 的既有行為（本 change 只「消費」權限點，不改角色機制）。

## Decisions

### D1. 定義順序：平台 feature 先定，租戶權限點對應（依賴 rbac change）
feature registry → 每個權限點恰好歸屬一個 feature（啟動驗證）→ RBAC 在 entitlement 天花板內生效。這是本 change 依賴 `rbac-granular-permissions` 的根因。詳 `design-notes/ARCH-PLATFORM-LAYER §0.1`。

### D2. 控制平面 vs 資料平面：同進程同 DB，認證/路由/guard 隔離
不拆獨立 app/DB（集中式 monorepo 一行 register 即可）。平台認證是第四條路徑（`psk_` 或平台專屬 JWT），`PLATFORM_SUPERUSER` role 只可能由平台簽發流程產生，租戶 JWT 永遠簽不出——這是隔離的根。詳 `ARCH-PLATFORM-LAYER §1-2`。

### D3. 平台身分獨立表 `PlatformUser`，不塞進 Agent
AgentRole 全是租戶內角色、每 Agent 綁 tenantId；跨租戶身分獨立表最乾淨、防洩漏。

### D4. Entitlement = Plan + override，掛在 Tenant（1:1）
`Tenant.planId` + `featureOverrides` Json，非另開表（每租戶恰一組 entitlement）。有效權限在 guard 內做「角色權限 ∩ ceiling」交集，即時算或快取 `eff:{roleId}:{tenantId}`。降級不刪資料（只夾天花板，升回自動恢復）。詳 `SPEC-PLATFORM-LAYER`。

### D5. AI token 記錄前置工程（計費/硬擋的共同前提）
改 `ChatProvider.generate()` 回傳帶 usage → 各 provider 解析（Ollama `eval_count`、Gemini `usageMetadata`）→ 新增 `AiUsage` 逐次落地。此工程獨立、優先、可先做。詳 `SPEC-PLATFORM-USAGE §4`。

### D6. 額度硬擋用 Redis 即時計數器（每日彙總擋不住即時超量）
`usage:tokens:{tenant}:{yyyy-mm}` 每次 AI 呼叫前檢查、呼叫後 INCRBY；達額度即擋。Redis 為即時真相、AiUsage 為持久對帳。BYOK 租戶預設不擋（成本不歸平台）。詳 `SPEC-PLATFORM-QUOTA-BILLING §2`。

### D7. Per-tenant AI key：三層 fallback + BYOK，沿用既有加密
`TenantSettings.aiKeysEncrypted`（AES-256-GCM 加密 JSON，沿用 channel 的 `encryptCredentials`，抽共用）。fallback 收斂在 provider 一行：`opts.apiKey ?? env`。`AiUsage.keySource` 區分計費歸屬（BYOK 不計平台金額）。詳 `SPEC-PLATFORM-AI-KEY`。

### D8. 升級/加購：租戶發起 → 平台核准（不接金流）
`PlanChangeRequest` 申請單；核准 upgrade 改 planId（走 entitlement 快取失效鏈解鎖功能）、核准 topup 提高額度並校準 Redis 解除硬擋。詳 `SPEC-PLATFORM-QUOTA-BILLING §3`。

### D9. 稽核照 CaseEvent 範式
`PlatformAuditLog`（actorId/action/targetTenantId/payload/createdAt）。平台每筆寫入操作必記。

## Risks / Trade-offs

- [跨租戶授權例外被誤用成隔離漏洞] 平台層是 CLAUDE.md「query 必含 tenantId」的唯一授權破例 → 程式碼與 guard 明確標示 platform-scope，且全部經稽核。
- [AI token 前置工程龐大] provider 介面改動牽連多處 → 獨立為第一階段先做，且介面改動有型別把關。
- [Redis 與 AiUsage 不一致] 並發下短暫偏差 → 以 Redis 擋、每日用 AiUsage 校準回寫。
- [全域表無先例] Plan/PlatformUser/PlatformAuditLog/AiModelPricing → schema 明確註解「platform-global, intentionally no tenantId」。
- [降級體驗] plan 掉級功能消失 → 通知租戶 admin + 不刪資料（升回恢復）。

## Migration Plan

分階段（可獨立上線）：
1. **AI token 記錄**（前置，純後端 + AiUsage 表）——先讓資料開始累積。
2. **Plan/entitlement 資料層 + licenseService per-tenant 化 + feature registry 對應驗證**。
3. **平台認證 + `/admin` + entitlement 交集 guard**。
4. **用量統計彙總 + 平台儀表板**。
5. **AI key per-tenant + BYOK**。
6. **額度硬擋（Redis 計數器）+ 升級/加購申請流程 + 租戶端頁**。

Rollback：各階段獨立；entitlement 未接前 guard 走原 RBAC；env key 保留為 fallback。

## Open Questions（已定案 2026-08-18）

- **平台 token = 平台專屬 JWT + 短 TTL**（✅ 定案）：簽發流程與 secret 與租戶 JWT 完全分離（不同 issuer/secret），`PLATFORM_SUPERUSER` role 只由此流程產生。
- **額度重置 = 自然月**（✅ 定案）：Redis 計數器 key 帶 `{yyyy-mm}`，月初 1 號自動換 key 重置。
- **加購 token = 申請時可選兩種**（✅ 定案）：`PlanChangeRequest.topupMode` = `one_time_month`（本月一次性、下月歸零）或 `raise_monthly`（永久調高 `Tenant.tokenQuotaMonthly`）。租戶申請時自選。
- **硬擋粒度 = 全擋（含 embedding）**（✅ 定案）：達額度時連 embedding（KB 搜尋）也擋，成本最省。⚠️ **體驗風險**：KB 搜尋會一併停用，租戶超量期間連「找資料」都不能，需在超量通知與租戶端明確告知「AI 與知識庫搜尋已暫停」，並確保真人客服流程不受影響（收件匣可正常人工回覆）。
- **BYOK 上限 = 預設不擋 + 平台可選開關**（✅ 定案）：BYOK 租戶預設不受平台額度硬擋（成本自付）；但平台層提供一個 per-tenant 開關 `enforceQuotaOnByok`，開啟後即使 BYOK 也套用平台額度（防濫用/特定方案限制）。
- **平台後台保護 = IP allowlist（首版）**（✅ 定案）：至少 IP allowlist；2FA 列第二階段。
