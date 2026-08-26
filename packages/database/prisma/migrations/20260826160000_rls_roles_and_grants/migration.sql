-- RLS 雙 role + GRANT（add-postgres-rls 步驟 2.1）。
-- app_tenant：一般請求連線，NOBYPASSRLS → 受 RLS 約束。
-- app_admin ：白名單/migration/scheduler 連線，BYPASSRLS → 跨租戶。
-- 密碼不寫進 migration（部署後由 provisioning 以 ALTER ROLE ... PASSWORD 設定）。
-- 冪等：role 已存在則跳過建立、只補 GRANT。

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant LOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin LOGIN BYPASSRLS;
  END IF;
END $$;

-- schema 使用權
GRANT USAGE ON SCHEMA public TO app_tenant, app_admin;

-- 對所有現有表授 CRUD（新表由後續 migration 或 ALTER DEFAULT PRIVILEGES 補）
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant, app_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant, app_admin;

-- 讓未來新建的表/序列自動授權給兩個 role（由 migrate 執行者 crm 建立的物件）
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant, app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_tenant, app_admin;
