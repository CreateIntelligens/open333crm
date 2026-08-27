-- RLS 第二批：所有「有 tenantId 欄位」的租戶表（標準 policy）。
-- 承 20260826170000（core: contacts/conversations/cases/messages）。
--
-- policy 統一：tenantId = NULLIF(current_setting('app.current_tenant', true), '')::uuid
--   （NULLIF 防未設定時空字串轉 uuid 拋 22P02，見 core migration 註解）
--
-- ⚠️ 前提：所有碰這些表的 route 已綁 request.tenantPrisma（受 RLS），交易 service 已改
--   withTenant，白名單/scheduler/認證走 prismaAdmin。否則 FORCE 後該路徑 fail-closed。
--
-- 排除：
--   - contacts/conversations/cases（core migration 已管）
--   - trial_signups（trial 防濫用跨租戶查候選，走 admin 白名單，不納入 RLS）
--   - 平台表 plans/platform_*/model_pricings/tenants（全域，走 admin）
--
-- 回滾：逐表 DISABLE ROW LEVEL SECURITY / DROP POLICY tenant_isolation。

DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'agents','ai_usages','automation_action_results','automation_executions',
  'automation_logs','automation_rules','broadcasts','campaigns','channels',
  'chatbox_sessions','cli_sessions','daily_stats','data_erasure_requests',
  'data_export_requests','flow_executions','identity_maps','interaction_flows',
  'kb_article_feedback','km_articles','materials','merge_suggestions',
  'message_templates','notifications','partner_api_keys','passkey_credentials',
  'plan_change_requests','point_transactions','portal_activities','portal_submissions',
  'quick_reply_presets','rich_menus','roles','segments','short_links','sla_policies',
  'tags','teams','tenant_audit_logs','tenant_settings','webhook_subscriptions'
];
BEGIN
  FOREACH t IN ARRAY tables
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
