## Why

多租戶資料隔離目前**只靠 app-layer**：每個 Prisma query 的 `where` 都要手動帶 `tenantId`（CLAUDE.md 明訂、`scripts/check-tenant-scoping.mjs` 靜態掃描把關）。這道防線的根本弱點是「漏一次就洩漏」——任何一個新 query 忘了帶 `tenantId`（尤其 `updateMany`/`deleteMany`）就是跨租戶讀寫，靜態掃描也只能抓已知模式、無法保證 100% 覆蓋。RBAC change 已把「租戶隔離 CI 檢查」列為現況 0 洩漏，但那是**偵測**不是**強制**。本 change 在資料庫層加上 Postgres Row-Level Security (RLS) 作為**第二道、且是 DB 強制的**隔離防線：即使 app 漏帶 tenantId，DB 也會自動只回傳/只允許當前租戶的資料列。這是 SaaS 化前把「跨租戶洩漏」從「靠紀律」升級為「靠資料庫」的根本性強化。

## What Changes

- **41 張租戶表**（見 `scripts/check-tenant-scoping.mjs` 的 `TENANT_MODELS`）逐一 `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`，並建立 policy：`USING (tenant_id = current_setting('app.current_tenant')::uuid)`（讀）與對應的 `WITH CHECK`（寫）。同期 `add-tenant-audit-gdpr` 新增的租戶表也一併納入。
- **每個帶租戶身分的 DB 操作 MUST 在交易內先設 session 變數**：以 `$transaction` + `SET LOCAL app.current_tenant = '<uuid>'` 的方式注入租戶身分（交易結束自動清除，**杜絕連線池殘留造成的間歇性跨租戶洩漏**——本 change 最高風險點）。API 與 workers 皆需接上此機制。
- **新增一個 app-tenant 應用 DB role**（非 superuser、無 `BYPASSRLS`）供一般請求使用；**保留一個 bypass 連線/role**（`BYPASSRLS` 或 superuser）供合法跨租戶操作使用（平台層、登入 email 全域解析、scheduler、trial 去重、chatbox publicKey 解析、inbound-router、以及 RLS migration 本身——即 `check-tenant-scoping.mjs` 白名單所列情境）。
- **分階段上線**：先 `ENABLE` 但 policy 設為 permissive/觀察，確認無誤擋後再 `FORCE`。提供快速回滾（`DISABLE ROW LEVEL SECURITY` 或切回 bypass role）。
- **新增驗證機制**：跨租戶隔離的整合測試（設 A 租戶 session 讀不到 B 租戶資料、`deleteMany` 不誤傷跨租戶）＋合法跨租戶查詢不被誤擋的測試。
- Prisma `schema.prisma` 對 41 表加 RLS 需以**手寫 migration SQL**（Prisma 不原生管理 RLS），符合 CLAUDE.md「必須產正式 migration 檔」規則。

## Capabilities

### New Capabilities
- `tenant-isolation-rls`: 以 Postgres Row-Level Security 在 DB 層強制多租戶資料隔離的機制——RLS policy 覆蓋範圍、session 變數注入契約（交易內 `SET LOCAL`）、bypass role 的合法跨租戶例外、分階段上線與回滾、驗證要求。

### Modified Capabilities
<!-- 無既有 spec 的 requirement 語意改變：app-layer 每 query 帶 tenantId 的既有規則維持不變（RLS 是額外一層，不取代），故不改動既有 capability。 -->

## Impact

- **DB / Migration**：新增手寫 migration（41 表 ENABLE/FORCE RLS + policy + app-tenant role + grant）；非破壞性 schema 變更（不改欄位），但**改變執行期行為**（未設 session 變數的租戶表 query 會回空/被擋），故上線需嚴格分階段。
- **DB 連線 / role**：需新增 `DATABASE_URL`（app-tenant role，受 RLS 約束）與 `DATABASE_URL_ADMIN` 或等效的 bypass 連線（供白名單情境與 migration）。`.env.*` 需新增變數。
- **後端 apps/api**：`prisma.plugin.ts` 目前是單一共享 `PrismaClient`；需引入「每請求在交易內設 `app.current_tenant`」的封裝（Prisma Client Extension 或 request-scoped helper），並讓白名單情境走 bypass 連線。
- **背景 apps/workers**：`index.ts` 的 `PrismaClient` 同樣需接上「每 job 依 payload.tenantId 設 session 變數」的機制。
- **測試**：需要對真實 DB 的整合測試（RLS 靠 DB 行為，mock 測不出來）；CI 需能跑帶 RLS 的 Postgres。
- **既有 app-layer 規則不移除**：`check-tenant-scoping.mjs --strict` 與「每 query 帶 tenantId」仍保留（縱深防禦，RLS 是後盾非替代）。
- **風險等級：高**——連線池 session 變數若做錯是最危險的失敗模式（間歇性、難重現的跨租戶洩漏），design.md 對此有專章。
