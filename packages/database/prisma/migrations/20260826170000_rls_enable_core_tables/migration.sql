-- RLS 核心表啟用（add-postgres-rls 步驟 5，第一批：contact/conversation/case/message）。
-- ENABLE + FORCE：連 table owner 也受 policy 約束（FORCE 必要，否則 owner/superuser 繞過）。
-- policy 依 session 變數 app.current_tenant（app_tenant 連線在交易內 set_config 注入）。
-- app_admin（BYPASSRLS）連線不受影響——白名單/scheduler/認證授權查詢仍跨租戶。
--
-- ⚠️ 用 NULLIF(current_setting(...), '')::uuid：current_setting(name, true) 在「未設定」時
-- 回**空字串**（非 NULL），直接 ''::uuid 會拋 22P02（invalid uuid），而非 fail-closed。
-- NULLIF 把空字串轉 NULL → 「tenantId = NULL」結果為 NULL → 無列（正確 fail-closed 且不拋錯）。
--
-- 回滾：見對應 down（DISABLE ROW LEVEL SECURITY / DROP POLICY）。

-- ── contacts / conversations / cases：有 tenantId 欄位，標準 policy ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','conversations','cases']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
      'WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;

-- ── messages：無 tenantId，靠 conversationId 間接隔離（conversation 屬當前租戶）──
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messages;
CREATE POLICY tenant_isolation ON messages
  USING (
    "conversationId" IN (
      SELECT id FROM conversations
      WHERE "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  )
  WITH CHECK (
    "conversationId" IN (
      SELECT id FROM conversations
      WHERE "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  );
