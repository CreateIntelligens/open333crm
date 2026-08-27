# Postgres RLS 部署 / 回滾 Runbook

機制與陷阱見 skill `postgres-rls-tenant-isolation`。本檔專注部署與回滾操作。

## 部署前置

1. **建立 DB role + 密碼**（migration `*_rls_roles_and_grants` 建 role 但不設密碼）：
   ```sql
   ALTER ROLE app_tenant PASSWORD '<強密碼>';
   ALTER ROLE app_admin  PASSWORD '<強密碼>';
   ```
2. **設 env**（apps/api、apps/workers）：
   ```
   DATABASE_URL_TENANT=postgresql://app_tenant:<pw>@<host>:<port>/<db>
   DATABASE_URL_ADMIN=postgresql://app_admin:<pw>@<host>:<port>/<db>
   ```
   ⚠️ 未設時 fallback 到 `DATABASE_URL`（app_tenant 與 admin 同一連線）——此時 RLS policy 存在但因連線非受限、或 migration 未 FORCE 而不生效，**行為與現況一致**（漸進上線階段 0）。

## 分階段上線（設計策略）

- **階段 0**：部署程式碼（withTenant + 雙 client + route 綁定），**不套 FORCE migration**。確認一切照舊。
- **階段 1（觀察）**：套 `*_rls_enable_core_tables`（core 4 表 FORCE）。監控是否有租戶查詢異常回空/報錯（代表某路徑漏綁）。核心表跑穩後再擴。
- **階段 2（擴表）**：套 `*_rls_enable_tenantid_tables`（40 表）+ `*_rls_enable_child_tables`（23 子表）。

## 部署後驗證（DB 層）

```sql
SET ROLE app_tenant;
SELECT set_config('app.current_tenant', '<某租戶id>', false);
SELECT count(*) FROM contacts;   -- 應=該租戶數
SELECT set_config('app.current_tenant', '<另一租戶id>', false);
SELECT count(*) FROM contacts;   -- 應=另一租戶數（看不到前者）
SELECT set_config('app.current_tenant', '', false);
SELECT count(*) FROM contacts;   -- 應=0（fail-closed）
RESET ROLE;
```

## 回滾

### 秒級軟回滾（第一手段，不改 DB）
把受約束連線暫切到 app_admin（BYPASSRLS）→ RLS 立即失效、恢復純 app-layer 隔離（不裸奔）：
```
DATABASE_URL_TENANT=postgresql://app_admin:<pw>@...   # 改 env
```
重啟 API/workers。判斷訊號：某租戶查詢突然大量回空、白名單功能報錯。

### DB 層回滾（逐表關 RLS）
```sql
-- 單表
ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;
ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON <t>;
-- 全部
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT relname FROM pg_class WHERE relrowsecurity=true AND relkind='r' LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.relname);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;
```
因 app-layer 隔離全程保留，回滾到「無 RLS」不會裸奔（回到 change 前狀態）。

## 已知限制 / 注意

- **PgBouncer**：若日後引入連線池代理，必須用 **transaction pooling**（session pooling 會破壞 SET LOCAL 的交易語意）。目前 Prisma 直連 Postgres，無此問題。
- **保留 fastify.prisma 的路徑**：webhook（公開入站，無 JWT，tenant 由 channel 反查靠 app-layer）、ai/mcp（跨模組聚合）——這些不受 RLS 覆蓋，仍靠 app-layer where tenantId。
- **排除 RLS 的表**：trial_signups（防濫用跨租戶）、plans/platform_*/model_pricings/tenants（平台全域）——走 admin。
