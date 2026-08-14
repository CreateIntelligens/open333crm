## Why

登入流程原本將租戶寫死為 `DEFAULT_TENANT_ID`（`auth.service.ts` 用複合鍵 `tenantId_email` 搭配寫死的租戶 UUID 查詢 agent），導致整個系統實際上只能服務單一租戶——無法開通第二個租戶、也無法讓不同租戶的使用者登入。

系統其餘部分其實**已是 tenant-aware**：JWT payload 已帶 `tenantId`、每個 request 從 token 解出租戶、資料層 62 個 model 中 36 個帶 `tenantId`、webhook 靠 `channel → tenantId` 動態解租戶。唯一的破口是「登入」這一點被釘死在單一租戶。

本變更解除這個破口，讓登入能用 email 全域唯一解析出所屬租戶，並補上「停用租戶不得登入 / 不處理其 inbound 訊息」的檢查（供欠費停權等場景使用）。這是 SaaS 化的多租戶技術地基。

> 註：本變更為 POC 階段「先立對地基」的一步。租戶自助開通端點、per-tenant 排程器等屬後續變更，不在此範圍。

## What Changes

- **Schema**：`Agent` model 的唯一約束從 `@@unique([tenantId, email])`（租戶內唯一）改為 `@@unique([email])`（全域唯一）。一個 email 只能屬於一個租戶，登入即可用 email 解析租戶。產出正式 migration（`20260814000000_agent_email_global_unique`：DROP 舊複合索引、CREATE `agents_email_key`）。
- **API `login()`**：改用 `findUnique({ where: { email } })` 跨租戶查出 agent，其 `agent.tenantId` 即為所屬租戶；不再引用 `DEFAULT_TENANT_ID`。一併 join `tenant.isActive`，租戶被停用時回 `TENANT_DISABLED`（403）。回傳值剝除 `passwordHash` 與 join 進來的 `tenant` 物件。
- **API webhook**：`processWebhookEvent` 載入 channel 時 join `tenant.isActive`；租戶停用時安靜丟棄該 inbound 事件（route 已早回 200，故直接 `return` 不 throw）。
- **API `createAgent()`**：重複 email 檢查改為 `findUnique({ where: { email } })` 全域查詢，維持乾淨的 409（否則跨租戶撞 email 會在 DB 層冒 P2002 → 500）。
- **Seed**：`seed.ts` 的 `agent.upsert` 從 `where: { tenantId_email }` 改為 `where: { email }`（複合鍵已移除，否則 `prisma generate` 後編譯失敗）。
- **常數**：保留 `DEFAULT_TENANT_ID`（僅供 seed / kb-ingest 等離線工具），更新註解警告勿在線上流程使用。
- **API analytics scheduler**：`setupAnalyticsScheduler` 由「只聚合寫死的單一租戶」改為遍歷所有 `isActive` 租戶各跑一次每日聚合（新增 `aggregateAllTenants` helper，單一租戶失敗不中斷其他），移除 `HARDCODED_TENANT_ID`。
- **前端**：無需變更（tenantId 埋在 JWT 由後端解析，登入頁只送 email + password）。

## Capabilities

### Modified Capabilities

- `auth-session`: 登入從單一寫死租戶改為 email 全域唯一的多租戶解析；新增停用租戶擋登入。

## Impact

- `packages/database/prisma/schema.prisma`：`Agent` model 唯一約束
- `packages/database/prisma/migrations/20260814000000_agent_email_global_unique/`：新 migration
- `packages/database/prisma/seed.ts`：agent upsert 的 where 子句
- `apps/api/src/modules/auth/auth.service.ts`：`login()` 租戶解析 + tenant.isActive 檢查
- `apps/api/src/modules/agent/agent.service.ts`：`createAgent()` 重複檢查改全域
- `apps/api/src/modules/webhook/webhook.service.ts`：`processWebhookEvent` 停用租戶丟棄事件
- `packages/shared/src/constants/tenant.ts`：常數註解
- `apps/api/src/modules/analytics/analytics.scheduler.ts`：改為遍歷所有 active tenant 各跑聚合（移除 `HARDCODED_TENANT_ID`）
- 部署注意：`migrate deploy` 前須確認目標環境無跨租戶重複 email，否則 unique migration 會失敗
