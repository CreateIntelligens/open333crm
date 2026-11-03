-- 收回 app_tenant 對平台層資料表的多餘權限（issue #412、AUDIT RLS-10）。
--
-- 20260826160000_rls_roles_and_grants 對整個 schema 授權 app_tenant 讀寫，包含沒有 RLS 的平台層表。
-- 平台層表沒有 RLS，app_tenant 能做什麼只由 GRANT 決定，所以這裡只留租戶路徑真正需要的 SELECT：
--   tenants            SELECT：停用檢查、租戶名稱、方案上限（getEffectiveLimit、channel.service 等）
--   plans              SELECT：方案上限、渠道白名單（隨 tenants 的 plan 關聯一起讀）
--   platform_settings  SELECT：readAiPrivacyPolicy 讀 ai.privacy.<tenantId>
--   model_pricings     SELECT：recordAiUsage → getPricing 算成本
--   platform_users、platform_audit_logs、trial_signups、_prisma_migrations：租戶路徑不使用，全部收回
-- 所有寫入平台層表的程式都走 app_admin（prismaAdmin），app_admin 的權限不變。
--
-- 必須以 table owner 執行（MIGRATE_DATABASE_URL）。REVOKE 只作用於目前資料庫的物件，
-- app_tenant 雖是整個 PostgreSQL 伺服器共用的角色，其他資料庫不受影響。可重複執行。

REVOKE ALL ON TABLE tenants, plans, platform_settings, model_pricings FROM app_tenant;
GRANT SELECT ON TABLE tenants, plans, platform_settings, model_pricings TO app_tenant;

REVOKE ALL ON TABLE platform_users, platform_audit_logs, trial_signups, _prisma_migrations FROM app_tenant;

-- 之後新建的表不再自動授權給 app_tenant。
-- 預設權限無法只排除平台層表，所以改成：新租戶表在開 RLS 的 migration 裡明確
-- GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO app_tenant;
-- 漏 GRANT 時租戶路徑回 permission denied（大聲失敗），不會像漏 REVOKE 那樣靜默開放平台表。
-- feature 測試 platform-table-grants.test.ts 檢查每張 FORCE RLS 的表都有這個 GRANT。
-- app_admin 的預設權限不變。
--
-- 原本的預設權限是建立表的角色（執行 migration 的 owner）設定的；逐一收回每個設定者對 app_tenant 的預設權限，
-- 避免 migration 執行者與當初設定者不同時漏掉。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT d.defaclrole::regrole::text AS grantor
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'public'
       AND d.defaclobjtype = 'r'
       AND d.defaclacl::text ~ '(^|[{,])app_tenant='
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %s IN SCHEMA public REVOKE ALL ON TABLES FROM app_tenant', r.grantor);
  END LOOP;
END $$;
