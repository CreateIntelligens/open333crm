-- change fix-automation-remaining-actions（AUDIT AUTO-01，issue #197）
--
-- assign_bot、kb_auto_reply、llm_reply 從契約拿掉。含這些動作的既有規則，契約驗證會失敗，
-- workers 整條略過（原本只略過這幾個動作）。這支 migration 在部署時和程式一起生效，沒有空窗：
--   1. 只含這 3 種動作的規則：停用（isActive = false），actions 保留原樣，管理員打開時看得到原本的設定。
--   2. 其他含這 3 種動作的規則：移除這 3 種動作，其他動作保留原順序，規則繼續執行。
-- 只動 automation_rules 的 actions、isActive、updatedAt；可重複執行（第二次執行時沒有符合的列）。
--
-- RLS：automation_rules 開了 FORCE ROW LEVEL SECURITY。migration 以 MIGRATE_DATABASE_URL（owner，
-- UAT 為 superuser，具 BYPASSRLS）執行，才看得到所有租戶的列。
--
-- 回滾：無法自動還原被移除的動作；需要時從備份還原 automation_rules.actions。

-- 1. 只含已停用動作的規則：停用
UPDATE automation_rules r
   SET "isActive" = false,
       "updatedAt" = now()
 WHERE jsonb_typeof(r.actions) = 'array'
   AND r."isActive" = true
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(r.actions) a
      WHERE a->>'type' IN ('assign_bot', 'kb_auto_reply', 'llm_reply')
   )
   AND NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(r.actions) a
      WHERE a->>'type' IS DISTINCT FROM 'assign_bot'
        AND a->>'type' IS DISTINCT FROM 'kb_auto_reply'
        AND a->>'type' IS DISTINCT FROM 'llm_reply'
   );

-- 2. 還有其他動作的規則：移除已停用的動作
UPDATE automation_rules r
   SET actions = (
         SELECT jsonb_agg(a ORDER BY ord)
           FROM jsonb_array_elements(r.actions) WITH ORDINALITY AS t(a, ord)
          WHERE a->>'type' IS DISTINCT FROM 'assign_bot'
            AND a->>'type' IS DISTINCT FROM 'kb_auto_reply'
            AND a->>'type' IS DISTINCT FROM 'llm_reply'
       ),
       "updatedAt" = now()
 WHERE jsonb_typeof(r.actions) = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(r.actions) a
      WHERE a->>'type' IN ('assign_bot', 'kb_auto_reply', 'llm_reply')
   )
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(r.actions) a
      WHERE a->>'type' IS DISTINCT FROM 'assign_bot'
        AND a->>'type' IS DISTINCT FROM 'kb_auto_reply'
        AND a->>'type' IS DISTINCT FROM 'llm_reply'
   );
