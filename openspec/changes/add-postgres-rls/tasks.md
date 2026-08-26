## 1. 前置調查（動 DB / 寫 SQL 前必做）

- [ ] 1.1 核對租戶表 DB 欄位實際名稱：讀 `packages/database/prisma/schema.prisma` 與現有 migration，確認是 `"tenantId"` 還是 `tenant_id`（policy SQL 用實際名，勿假設）
- [ ] 1.2 由 schema 動態列出**所有含 `tenantId` 的表**作為 RLS 覆蓋清單（以此為準，不寫死 41），與 `check-tenant-scoping.mjs` 的 `TENANT_MODELS` 交叉核對差異
- [ ] 1.3 確認 `add-tenant-audit-gdpr` 會新增哪些租戶表，納入覆蓋清單（協調：其 migration 帶 RLS 或本 change 補）
- [ ] 1.4 盤點既有 `$queryRaw`/`$executeRaw` 是否碰租戶表（目前多在測試；確認生產路徑無漏網 raw query）
- [ ] 1.5 驗證 Prisma 6 `$transaction` + `$executeRaw`(`set_config(..., true)`) 在互動式交易內對後續 `tx` query 生效（小 POC）

## 2. DB Role 與連線設定

- [ ] 2.1 建立 `app_tenant` role（LOGIN、`NOBYPASSRLS`）與 `app_admin` role（LOGIN、`BYPASSRLS`），GRANT 對租戶表的 SELECT/INSERT/UPDATE/DELETE（放進 migration 或 provisioning SQL）
- [ ] 2.2 新增 env：`DATABASE_URL`（app_tenant，受 RLS）與 `DATABASE_URL_ADMIN`（app_admin，bypass）；更新 `apps/api/.env.example`、`.env.api.example`、`.env.workers.example`、`config/env.ts` 的 zod schema
- [ ] 2.3 部署文件註明兩條連線的角色與「切 admin 即軟回滾」機制

## 3. App 端注入機制（階段 0，不改 DB 行為）

- [ ] 3.1 實作 `withTenant(prisma, tenantId, fn)`：`$transaction` 內先 `SELECT set_config('app.current_tenant', ${tenantId}, true)`（參數化），tenantId 進入前先驗證合法 UUID
- [ ] 3.2 API：`prisma.plugin.ts` 提供 request-scoped tenant-bound client（`$extends` 或 `request.tenantPrisma`），帶租戶 JWT 的請求其租戶表操作皆經 `withTenant`
- [ ] 3.3 API：白名單服務改用 `prismaAdmin`（app_admin 連線）——`modules/platform/*`、`auth.service`、`partner-api-key`、`auth.plugin`、`*.scheduler.*`、`platform-tenant.service`、`chatbox.service`、`modules/trial/*`、`inbound-router`
- [ ] 3.4 scheduler：先用 admin 取租戶清單，對單租戶寫入時改用 `withTenant` 綁定該租戶（縮小 bypass 面積）
- [ ] 3.5 Workers：`apps/workers/src/index.ts` job handler 依 `payload.tenantId` 呼叫 `withTenant`；跨租戶 job（若有）用 admin 連線
- [ ] 3.6 （建議）加 CI 檢查：非白名單檔案不得 import `prismaAdmin`，防 bypass 擴散
- [ ] 3.7 部署階段 0 並確認現況功能全部照舊（此時 RLS 未開，set_config 無副作用）

## 4. Migration — 階段 1（ENABLE + 觀察）

- [ ] 4.1 用 `prisma migrate dev --create-only` 產空 migration，手寫 SQL：對覆蓋清單各表 `ENABLE ROW LEVEL SECURITY` + 先建 permissive/觀察 policy（或 ENABLE 不 FORCE）
- [ ] 4.2 加監控/log：受約束連線觸及租戶表但 `app.current_tenant` 為 NULL 的情況（抓未接上注入的漏網路徑）
- [ ] 4.3 部署觀察數日，確認所有正常流量都有設租戶身分、白名單流量都走 admin，零漏接

## 5. Migration — 階段 2（FORCE enforce，可分批）

- [ ] 5.1 換上正式 policy：`USING ("tenantId" = current_setting('app.current_tenant', true)::uuid)` + 對稱 `WITH CHECK`；加 `FORCE ROW LEVEL SECURITY`
- [ ] 5.2 分批 enforce：先核心表（contact/conversation/case/message 相關），驗證後再擴其餘
- [ ] 5.3 每批皆為正式 Prisma migration 檔（`migrate deploy` 可跑），附對應 down（DISABLE / DROP POLICY）

## 6. 驗證（對真實 Postgres，含 RLS role）

- [ ] 6.1 整合測試（正向）：綁定租戶 A 的 app_tenant 連線，對租戶表 SELECT/updateMany/deleteMany MUST 只影響 A，B 完全不受影響
- [ ] 6.2 整合測試（fail-closed）：未設 `app.current_tenant` 時租戶表查詢回 0 列 / 影響 0 列
- [ ] 6.3 整合測試（WITH CHECK）：試圖 INSERT/UPDATE 成別租戶 tenantId MUST 被拒
- [ ] 6.4 整合測試（連線池不殘留）：連續兩個交易分別綁 A、B，第二個只見 B（驗 SET LOCAL 語意）
- [ ] 6.5 整合測試（白名單）：BYPASSRLS 連線的登入 email 全域解析 / 平台跨租戶統計 MUST 通過不被誤擋
- [ ] 6.6 覆蓋完整性檢查：自動比對「所有含 tenantId 的表」皆有 RLS policy，遺漏則 fail（可併入 CI）
- [ ] 6.7 CI：起帶 app_tenant/app_admin role 的 Postgres 容器跑上述整合測試
- [ ] 6.8 typecheck（api + workers）EXIT 0；`check-tenant-scoping.mjs --strict` 仍 pass（app-layer 防線保留）

## 7. 回滾預案與文件

- [ ] 7.1 驗證軟回滾：把受約束連線暫切至 app_admin（改 env 重啟）→ RLS 立即失效、功能恢復、app-layer 仍隔離不裸奔
- [ ] 7.2 備妥 DB 層回滾（逐表 DISABLE / DROP POLICY）並實測 down migration
- [ ] 7.3 部署 runbook：上線判斷訊號（租戶查詢異常回空、白名單功能報錯）、回滾步驟、PgBouncer 相容性註記（若日後引入須 transaction pooling）
- [ ] 7.4 更新 CHANGELOG.md（Added：Postgres RLS 租戶隔離；Changed：DB 連線改雙 role）
