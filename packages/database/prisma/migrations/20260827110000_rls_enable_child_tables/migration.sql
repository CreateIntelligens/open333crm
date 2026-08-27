-- RLS 第三批：無 tenantId 的子表，靠外鍵父表間接隔離（subquery policy，像 messages）。
-- 每個子表：fk_col IN (SELECT id FROM 父表)，父表 policy 已依 current_tenant 過濾，
-- 故子表只看得到「父物件屬當前租戶」的列。多 FK 子表取主隔離父（如 case_events 用 caseId）。
--
-- 父表已 FORCE（core + tenantId 表批）。current_tenant 未設時父表 subquery 回空 → 子表 fail-closed。
-- 回滾：逐表 DISABLE ROW LEVEL SECURITY / DROP POLICY。

DO $$
DECLARE r record;
-- child_table, fk_column, parent_table
DECLARE specs text[][] := ARRAY[
  ARRAY['agent_team_members','agentId','agents'],
  ARRAY['broadcast_recipients','broadcastId','broadcasts'],
  ARRAY['case_events','caseId','cases'],
  ARRAY['case_notes','caseId','cases'],
  ARRAY['case_relations','fromCaseId','cases'],
  ARRAY['case_tags','caseId','cases'],
  ARRAY['channel_identities','contactId','contacts'],
  ARRAY['channel_team_accesses','channelId','channels'],
  ARRAY['channel_usages','channelId','channels'],
  ARRAY['click_logs','shortLinkId','short_links'],
  ARRAY['contact_attributes','contactId','contacts'],
  ARRAY['contact_relations','fromContactId','contacts'],
  ARRAY['contact_tags','contactId','contacts'],
  ARRAY['conversation_tags','conversationId','conversations'],
  ARRAY['flow_logs','executionId','flow_executions'],
  ARRAY['interaction_nodes','flowId','interaction_flows'],
  ARRAY['km_article_attachments','articleId','km_articles'],
  ARRAY['long_term_memories','contactId','contacts'],
  ARRAY['portal_fields','activityId','portal_activities'],
  ARRAY['portal_options','activityId','portal_activities'],
  ARRAY['role_permissions','roleId','roles'],
  ARRAY['template_views','templateId','message_templates'],
  ARRAY['webhook_deliveries','subscriptionId','webhook_subscriptions']
];
DECLARE i int;
DECLARE child text; DECLARE fk text; DECLARE parent text;
BEGIN
  FOR i IN 1 .. array_length(specs, 1)
  LOOP
    child := specs[i][1]; fk := specs[i][2]; parent := specs[i][3];
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', child);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (%I IN (SELECT id FROM %I)) '
      'WITH CHECK (%I IN (SELECT id FROM %I))',
      child, fk, parent, fk, parent
    );
  END LOOP;
END $$;
