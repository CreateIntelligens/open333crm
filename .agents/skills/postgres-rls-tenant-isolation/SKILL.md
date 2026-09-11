---
name: postgres-rls-tenant-isolation
description: Open333CRM 多租戶 Postgres RLS（Row-Level Security）隔離的實作機制、接線規則、陷阱與驗證方法。做任何 RLS 相關的收尾、除錯、加新表、改 route/service 的 prisma 綁定、或排查「查詢突然回空/403」時使用。
metadata:
  author: daniel
  version: "1.0"
---

# Postgres RLS 租戶隔離 Skill

Open333CRM 的多租戶隔離＝**app-layer（每 query where tenantId）＋ Postgres RLS（DB 層強制）**雙層。
本 skill 記錄 RLS 的實作機制與所有非顯而易見的陷阱（皆經真實 FORCE RLS 實測驗證）。

對應 OpenSpec change：`openspec/changes/add-postgres-rls/`（proposal/design/tasks）。

## 核心機制（一句話）

app_tenant 連線（NOBYPASSRLS）＋ 每個租戶操作在**交易內 `set_config('app.current_tenant', tid, is_local=true)`** → RLS policy 依此 session 變數過濾。白名單（跨租戶）走 app_admin 連線（BYPASSRLS）。

## 為什麼是「交易內 SET LOCAL」（安全性根源）

Prisma 單一共享連線池跨請求複用連線。若用 session 級 `SET app.current_tenant`，值會**殘留**在連線上，下個請求（別租戶）拿到同連線就讀到別人資料——**間歇性、與併發相關、幾乎無法單元測試重現**的最危險失敗模式。

`SET LOCAL`（＝`set_config(name, value, true)`）只在該交易有效，`COMMIT`/`ROLLBACK` 後自動失效，**連線歸還池不可能殘留**。安全性來自 Postgres 交易語意，不靠應用紀律。

已 POC 驗證：交易內 `set_config` 生效、交易外 `current_setting('app.current_tenant', true)` 回空。

## 關鍵檔案

- **`apps/api/src/lib/tenant-db.ts`** — 心臟：
  - `withTenant(prisma, tenantId, fn)` — 在綁定交易內執行 fn（tenantId 先驗 UUID）
  - `tenantScopedClient(base, tenantId)` — `$extends` 全域綁定：每個 model 操作自動包進 withTenant
  - `TenantDb` 型別＝`PrismaClient | Prisma.TransactionClient | TenantScopedClient`
- **`apps/api/src/plugins/prisma.plugin.ts`** — 雙 client：
  - `fastify.prisma`（app_tenant，受 RLS）／`fastify.prismaAdmin`（app_admin，BYPASSRLS）
  - `request.tenantPrisma`（getter，依 `request.agent.tenantId` 綁定當前租戶）
  - env：`DATABASE_URL_TENANT`／`DATABASE_URL_ADMIN`；未設時 fallback 到 `DATABASE_URL`（階段 0 相容，RLS 未 FORCE 時行為不變）
- **migrations**：`*_rls_roles_and_grants`（雙 role + GRANT）、`*_rls_enable_core_tables`（policy）

## $extends 全域綁定的正確寫法（易錯！）

`$allOperations` 內**不可**用 `query(args)`——它會跳出我們的交易、落到別的連線 → set_config 讀不到 → fail-closed 回空。**必須在 withTenant 的 tx 上重發**：

```ts
async $allOperations({ model, operation, args }) {
  return withTenant(base, tenantId, async (tx) => {
    const key = model.charAt(0).toLowerCase() + model.slice(1); // Contact → contact
    return (tx as any)[key][operation](args);
  });
}
```
（POC 驗證：用 `query(args)` → count=0（錯）；用 tx 重發 → count=34（對）。）

## 接線規則：哪個 client 用在哪

| 情境 | 用哪個 | 為什麼 |
|---|---|---|
| 租戶 route handler → service（純 model 操作） | `request.tenantPrisma` | 受 RLS，綁定當前租戶 |
| 授權查詢（rbac.guard 的 getTenantPlanId/getEffectiveTenantPermissions） | `request.server.prismaAdmin` | 授權基礎設施，跨 tenant/role 表 |
| 認證入口（login email 全域解析、passkey、CLI/partner 驗證） | `prismaAdmin` | 身分確立前／跨租戶查候選 |
| scheduler/worker（掃全租戶或以 payload.tenantId 自 scope） | `app.prismaAdmin`（index.ts setup 傳入） | 可信背景基礎設施 |
| 平台層 route（platform/plan-change） | `fastify.prismaAdmin` | 平台跨租戶管理 |
| 公開端點（webhook 入站，無 JWT） | `fastify.prisma` + TODO | 無租戶身分；tenant 由 channelId 反查，走 app-layer |
| 交易 service（含 `$transaction`） | 保留 `fastify.prisma` + `// TODO(rls)` | $extends 不能包已含交易的 service |

index.ts 白名單接線清單見該檔 `// RLS 白名單基礎設施` 註解區。

## 陷阱清單（都踩過並驗證）

1. **messages 表無 tenantId** → policy 不能用 tenantId，要 conversationId subquery：
   `USING ("conversationId" IN (SELECT id FROM conversations WHERE "tenantId" = current_setting('app.current_tenant', true)::uuid))`。凡是「無 tenantId 靠外鍵間接隔離」的表都要這樣。
2. **交易 service 不能收 tenantPrisma**（$extends 打散交易，失去原子性）。含 `$transaction` 的函式參數維持 `PrismaClient`，route 保留 `fastify.prisma` + `// TODO(rls)`；正解是改造為 `withTenant(prisma, tid, tx => service(tx, ...))`。用 `grep -n '\$transaction' <service>` 找出。
3. **`groupBy` 在 TenantDb union 型別下 TS 報 "union of overloads not callable"**（`count`/`findMany` 無此問題）。局部 cast：`(prisma.case as PrismaClient).groupBy(...)` 或 `(prisma.x as any).groupBy(...)`，執行期仍走 RLS。
4. **raw query（$queryRaw/$executeRaw/Unsafe）已解決**：`$allOperations` 只攔 model 操作，故另在 `tenantScopedClient` 的 **`client` 區塊覆寫這 4 個 raw 方法**，走 withTenant 在綁定交易內執行（tx 重發、保留泛型 `<T>`）。所以 analytics/knowledge/embedding 的 raw query 會自動綁定租戶、受 RLS 覆蓋，**零改動**。⚠️ 但若有人用 base `fastify.prisma.$queryRaw`（非 tenantPrisma）仍不綁定——碰租戶表的 raw 要走 tenantPrisma 或明確 withTenant。
5. **policy 空字串轉型錯（重要）**：`current_setting('app.current_tenant', true)` 在**未設定**時回**空字串（非 NULL）**，直接 `''::uuid` 拋 `22P02 invalid uuid` 而非 fail-closed。policy **必須用 `NULLIF(current_setting(...), '')::uuid`** → 空字串轉 NULL → `tenantId = NULL` 無列（正確 fail-closed 不拋錯）。所有 policy（含 subquery）都要這樣寫。
6. **跨模組 helper 收 bare `PrismaClient`**（如 getEffectiveLimit/getEffectivePermissions）→ 呼叫它的 service 也不能乾淨吃 TenantScopedClient，保留 fastify.prisma + TODO。
7. **FORCE 必要**：只 ENABLE 不 FORCE 時 table owner／superuser 會繞過 policy。用 `ALTER TABLE x FORCE ROW LEVEL SECURITY`。
8. **fail-closed 的副作用**：白名單路徑漏接 admin → FORCE 後碰租戶表回空/關聯 null → 查詢崩（如 analytics scheduler 用 fastify.prisma 碰 contacts）。這是「好的吵」——立刻暴露漏接。
9. **tenant 表本身不納入 RLS**（它的租戶識別是 `id` 非 tenantId，且由 admin 查）。
10. **fire-and-forget 副作用不可用交易 tx**：若 service 收 `withTenant` 的 tx，其**未 await 的** fire-and-forget 呼叫（如 `autoAssignCase(tx,...).catch()`）會在交易 commit、連線關閉「之後」才執行 → `Transaction already closed`（副作用靜默失效，被 .catch 吞掉）。正解：交易 service 收 **base PrismaClient**，DB 寫入包 `withTenant`，副作用在 withTenant 之後用 `tenantScopedClient(prisma, tid)`（各自短交易綁定）。收 tenantPrisma（非交易）的 service 則無此問題（每 op 各自綁定）。見 createCaseFromConversation。
11. **雙 FK 子表要驗兩個父參照**：case_relations(from/toCaseId)、contact_relations(from/toContactId) 若 policy 只驗一個 FK，可寫出「一端本租戶、另一端他租戶」的關聯（WITH CHECK fail-open）。policy 要 `fromX IN(...) AND toX IN(...)`。
12. **$extends 每 op 開獨立交易**：tenantScopedClient 的每個 model 操作各開 BEGIN→set_config→op→COMMIT。`Promise.all` 扇出（如 analytics 多個 count 並發）會同時佔多條連線——注意連線池上限（Prisma 預設 connection_limit）。效能敏感的並發查詢考慮改用單一 `withTenant` 包整組。
13. **逃逸口**：TenantScopedClient 仍暴露 `$transaction`（其內 tx 不經 $extends 覆寫、不 set_config）與 `$queryRawTyped`（未覆寫）——直接用它們會落未綁定連線。碰租戶表的這類操作要明確 withTenant。
14. **migration / seed 必須用 owner 連線，不能用 app_tenant（RLS 上線後最容易炸的部署陷阱）**：RLS 啟用後 app runtime 的 `DATABASE_URL` 指向受 RLS 的 `app_tenant`（NOBYPASSRLS、**非 table owner**）。若 entrypoint 的 `prisma migrate deploy` 沿用同一連線跑 DDL（`ALTER TABLE` 等），Postgres 以 **`must be owner of table X`（42501 / Prisma `P3018`）** 擋下——**RLS 切 role 後的第一個新 migration 就會卡死、API 啟動失敗、部署中斷**。（注意：`app_admin` 雖 BYPASSRLS 但**仍非 owner**，DDL 一樣被擋；要的是 owner 如 `crm`/superuser。）seed 同理——`INSERT` 受 RLS WITH CHECK 擋（`new row violates row-level security policy`）。正解：entrypoint migrate/seed 走**專用 `MIGRATE_DATABASE_URL`（指向 table owner）**，未設 fallback `DATABASE_URL`（相容未啟用 RLS 環境）；見 `apps/api/docker-entrypoint.sh`（PR #158）。⚠️ 之前的 RLS migration 之所以「成功」，是因為當時 `DATABASE_URL` 還是 owner（切 app_tenant 前跑的）——**切 role 那刻起，未走 owner 的 migrate 全會炸**。手動救援：用 owner 補跑該 migration 的 DDL + `UPDATE _prisma_migrations SET finished_at=now(), logs=NULL WHERE migration_name=... AND finished_at IS NULL` 標記成功，再重啟。

## RLS 相關的除錯：「查詢突然回空 / 403」

- **租戶查詢回空** → 該路徑用了 fastify.prisma（未綁定）而非 request.tenantPrisma，或 raw query 沒設 tenant。
- **403 FORBIDDEN** → 可能是 rbac.guard 沒走 admin（權限查詢 fail-closed）。確認 rbac.guard 用 prismaAdmin。
- **關聯 null / 查詢崩** → include 的關聯表 RLS 擋住（該連線沒設 tenant）。多見於白名單漏接。
- 相關快取陷阱另見 memory `project_tenant_plan_cache`（60s 進程內 plan 快取）。

## 驗證方法（DB 層，最可靠）

```sql
SET ROLE app_tenant;
-- fail-closed：未綁定應 0
SELECT count(*) FROM contacts;
-- 綁 Demo：SELECT set_config('app.current_tenant','a0000000-...',false); count 應=該租戶數
-- 綁別租戶：count 應=0（看不到 Demo）
-- WITH CHECK：INSERT 別租戶 tenantId → 應 "violates row-level security policy"
RESET ROLE;
```
已驗證結果：未綁定=0、綁 Demo=34、綁 GGYY=0、messages(subquery)=739、越權 INSERT 被擋。

## 分階段上線（設計策略）

- 階段 0：接注入機制（withTenant + 雙 client + route 綁定），DB 不 FORCE，行為照舊。
- 階段 1：ENABLE + permissive/觀察（抓漏接：session 變數 NULL 卻碰租戶表）。
- 階段 2：FORCE + 正式 policy，可分批（先核心表 contact/conversation/case/message，驗證後擴其餘）。
- **軟回滾**：把 app_tenant 連線暫切到 app_admin（改 env 重啟）→ RLS 立即失效、app-layer 仍在不裸奔。DB 層回滾＝`DISABLE ROW LEVEL SECURITY`／`DROP POLICY`。

## 本機驗證環境

- 雙 role 已建（migration）；本機密碼：app_tenant/tenantpw、app_admin/adminpw
- 起 API 配 RLS：`DATABASE_URL_TENANT=postgresql://app_tenant:tenantpw@localhost:5433/... DATABASE_URL_ADMIN=postgresql://app_admin:adminpw@localhost:5433/...`
- 測完務必還原核心表 RLS（`DISABLE ROW LEVEL SECURITY`）＋ API 回單連線，否則本機 dev 的未改 route/TODO 交易 service 會回空。
