-- scripts/dedupe-sla-events.mjs 使用的 SQL（issue #320）。
--
-- 每個 `-- @名稱` 標記一段，一段只放一個語句（Prisma 的 raw 查詢一次只能執行一個語句）。
-- 腳本先執行 @params 設定本次的條件，再依序執行其他段落。
-- tests/feature/scripts/dedupe-sla-events.test.ts 在 owner 交易內執行這些段落後回滾。
--
-- 參數（交易內的 session 設定，SET LOCAL 等級，交易結束就消失）：
--   sla_dedupe.cutoff   ISO 8601 時間，只刪這個時間之前寫入的列（#281 上線時間）
--   sla_dedupe.tenants  逗號分隔的租戶 ID；空字串表示所有租戶
--
-- 欄位型別：createdAt 是 timestamp(3) without time zone，存的是 UTC，
-- 所以 cutoff 轉成 UTC 的 timestamp 再比較。

-- @guard
-- case_events、notifications 都是 FORCE ROW LEVEL SECURITY。執行身分若不能略過 RLS，
-- 查詢會回 0 列，預覽顯示「沒有重複」但其實是看不到。寧可直接失敗。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION '清理需要能略過 RLS 的資料庫身分（superuser 或 BYPASSRLS），目前是 %。請以 MIGRATE_DATABASE_URL 指向 owner 執行。', current_user;
  END IF;
END
$$;

-- @params
SELECT set_config('sla_dedupe.cutoff', $1, true) AS cutoff,
       set_config('sla_dedupe.tenants', $2, true) AS tenants;

-- @ranked-events
-- 系統寫入的 SLA 時間軸事件，依「工單 + 事件類型 + 期限 key」分組排序。
-- 期限 key（與 apps/workers/src/handlers/sla.handler.ts 的去重起點對應）：
--   first_response_breached、sla_breached：facts['sla.dueAt']
--   first_response_warning、sla_warning：facts['sla.dueAt'] + facts['sla.warningBeforeMinutes']
--   customer_waiting_breached：facts['case.lastAgentReplyAt']（null 也是一組：客服從未回覆）
-- 沒有 key 的列（#281 之前更早的版本沒有寫 facts）dedupe_key 為 NULL、rn 為 NULL，不列入刪除。
-- 排序包含 cutoff 之後的列：cutoff 之後還有重複（rn > 1）表示 cutoff 給錯了。
CREATE TEMP TABLE sla_dedupe_ranked_events ON COMMIT DROP AS
WITH params AS (
  SELECT (current_setting('sla_dedupe.cutoff')::timestamptz AT TIME ZONE 'UTC') AS cutoff,
         string_to_array(nullif(current_setting('sla_dedupe.tenants'), ''), ',')::uuid[] AS tenants
),
sla_events AS (
  SELECT e.id,
         c."tenantId" AS tenant_id,
         e."caseId" AS case_id,
         e."eventType" AS event_type,
         e."createdAt" AS created_at,
         CASE WHEN jsonb_typeof(e.payload->'facts') = 'object' THEN e.payload->'facts' END AS facts
  FROM case_events e
  JOIN cases c ON c.id = e."caseId"
  CROSS JOIN params p
  WHERE e."actorType" = 'system'
    AND e."eventType" IN ('first_response_breached', 'first_response_warning', 'sla_breached', 'sla_warning', 'customer_waiting_breached')
    AND (p.tenants IS NULL OR c."tenantId" = ANY (p.tenants))
),
keyed AS (
  SELECT s.*,
         CASE
           WHEN s.event_type IN ('first_response_breached', 'sla_breached')
             THEN s.facts->>'sla.dueAt'
           WHEN s.event_type IN ('first_response_warning', 'sla_warning')
                AND s.facts->>'sla.dueAt' IS NOT NULL
                AND s.facts ? 'sla.warningBeforeMinutes'
             THEN (s.facts->>'sla.dueAt') || '|' || coalesce(s.facts->>'sla.warningBeforeMinutes', '')
           WHEN s.event_type = 'customer_waiting_breached'
                AND s.facts ? 'case.lastAgentReplyAt'
             THEN coalesce(s.facts->>'case.lastAgentReplyAt', '')
         END AS dedupe_key
  FROM sla_events s
)
SELECT k.id, k.tenant_id, k.case_id, k.event_type, k.created_at, k.dedupe_key,
       k.created_at < p.cutoff AS before_cutoff,
       CASE WHEN k.dedupe_key IS NOT NULL THEN
         row_number() OVER (PARTITION BY k.case_id, k.event_type, k.dedupe_key ORDER BY k.created_at, k.id)
       END AS rn
FROM keyed k
CROSS JOIN params p;

-- @event-targets
CREATE TEMP TABLE sla_dedupe_event_targets ON COMMIT DROP AS
SELECT id FROM sla_dedupe_ranked_events
WHERE rn > 1 AND before_cutoff;

-- @ranked-notifications
-- #281 之前的 SLA 預設通知（英文標題）。notifications 沒有 caseId，clickUrl 是 /dashboard/cases/<id>，
-- 所以依「成員 + 類型 + clickUrl（工單）+ 標題」分組，只留最早一筆。
-- 自動化規則的通知（例如 'SLA rule matched'）與 #281 之後的中文標題不在範圍內。
CREATE TEMP TABLE sla_dedupe_ranked_notifications ON COMMIT DROP AS
WITH params AS (
  SELECT (current_setting('sla_dedupe.cutoff')::timestamptz AT TIME ZONE 'UTC') AS cutoff,
         string_to_array(nullif(current_setting('sla_dedupe.tenants'), ''), ',')::uuid[] AS tenants
)
SELECT n.id, n."tenantId" AS tenant_id, n.type, n."createdAt" AS created_at,
       n."createdAt" < p.cutoff AS before_cutoff,
       row_number() OVER (PARTITION BY n."agentId", n.type, n."clickUrl", n.title ORDER BY n."createdAt", n.id) AS rn
FROM notifications n
CROSS JOIN params p
WHERE (n.type, n.title) IN (
        ('first_response_breached', 'First response SLA breached'),
        ('first_response_warning', 'First response SLA warning'),
        ('sla_breached', 'Resolution SLA breached'),
        ('sla_warning', 'Resolution SLA warning'),
        ('customer_waiting_breached', 'Customer waiting SLA breached')
      )
  AND (p.tenants IS NULL OR n."tenantId" = ANY (p.tenants));

-- @notification-targets
CREATE TEMP TABLE sla_dedupe_notification_targets ON COMMIT DROP AS
SELECT id FROM sla_dedupe_ranked_notifications
WHERE rn > 1 AND before_cutoff;

-- @count-events
SELECT r.tenant_id AS "tenantId", t.name AS "tenantName", r.event_type AS "eventType",
       count(*)::int AS "toDelete"
FROM sla_dedupe_ranked_events r
JOIN sla_dedupe_event_targets x ON x.id = r.id
JOIN tenants t ON t.id = r.tenant_id
GROUP BY r.tenant_id, t.name, r.event_type
ORDER BY t.name, r.tenant_id, r.event_type;

-- @count-notifications
SELECT r.tenant_id AS "tenantId", t.name AS "tenantName", r.type AS "type",
       count(*)::int AS "toDelete"
FROM sla_dedupe_ranked_notifications r
JOIN sla_dedupe_notification_targets x ON x.id = r.id
JOIN tenants t ON t.id = r.tenant_id
GROUP BY r.tenant_id, t.name, r.type
ORDER BY t.name, r.tenant_id, r.type;

-- @after-cutoff-events
SELECT count(*)::int AS count FROM sla_dedupe_ranked_events WHERE rn > 1 AND NOT before_cutoff;

-- @after-cutoff-notifications
SELECT count(*)::int AS count FROM sla_dedupe_ranked_notifications WHERE rn > 1 AND NOT before_cutoff;

-- @missing-key
SELECT event_type AS "eventType", count(*)::int AS count
FROM sla_dedupe_ranked_events
WHERE dedupe_key IS NULL
GROUP BY event_type
ORDER BY event_type;

-- @top-cases
SELECT r.case_id AS "caseId", r.tenant_id AS "tenantId", t.name AS "tenantName",
       c.title AS "caseTitle", c.status::text AS "caseStatus", count(*)::int AS "toDelete"
FROM sla_dedupe_ranked_events r
JOIN sla_dedupe_event_targets x ON x.id = r.id
JOIN cases c ON c.id = r.case_id
JOIN tenants t ON t.id = r.tenant_id
GROUP BY r.case_id, r.tenant_id, t.name, c.title, c.status
ORDER BY "toDelete" DESC, r.case_id
LIMIT 10;

-- @affected-rules
-- 工單的 sla.breachCount / sla.escalationLevel 是「逾期類事件的筆數」（sla.handler.ts getSlaBreachCount）。
-- 刪掉逾期類重複事件後數字變小，依它判斷的規則會比較晚觸發。列出這些租戶裡啟用中的規則供確認。
SELECT ar.id, ar."tenantId", t.name AS "tenantName", ar.name, ar."eventType"
FROM automation_rules ar
JOIN tenants t ON t.id = ar."tenantId"
WHERE ar.enabled AND ar."isActive"
  AND (ar.conditions::text LIKE '%sla.breachCount%' OR ar.conditions::text LIKE '%sla.escalationLevel%')
  AND ar."tenantId" IN (
    SELECT r.tenant_id
    FROM sla_dedupe_ranked_events r
    JOIN sla_dedupe_event_targets x ON x.id = r.id
    WHERE r.event_type IN ('first_response_breached', 'sla_breached', 'customer_waiting_breached')
  )
ORDER BY t.name, ar.name, ar.id;

-- @target-totals
SELECT (SELECT count(*)::int FROM sla_dedupe_event_targets) AS events,
       (SELECT count(*)::int FROM sla_dedupe_notification_targets) AS notifications;

-- @export-events
-- 刪除前匯出整列（含所屬租戶），依 id 分批讀取：$1 = 上一批最後的 id，$2 = 每批筆數
SELECT e.id, c."tenantId", e."caseId", e."actorType", e."actorId", e."eventType",
       e.payload::text AS payload, e."createdAt"
FROM case_events e
JOIN sla_dedupe_event_targets x ON x.id = e.id
JOIN cases c ON c.id = e."caseId"
WHERE e.id > $1::uuid
ORDER BY e.id
LIMIT $2::int;

-- @export-notifications
SELECT n.id, n."tenantId", n."agentId", n.type, n.title, n.body, n."clickUrl",
       n."isRead", n."readAt", n."createdAt"
FROM notifications n
JOIN sla_dedupe_notification_targets x ON x.id = n.id
WHERE n.id > $1::uuid
ORDER BY n.id
LIMIT $2::int;

-- @delete-events
DELETE FROM case_events WHERE id IN (SELECT id FROM sla_dedupe_event_targets);

-- @delete-notifications
DELETE FROM notifications WHERE id IN (SELECT id FROM sla_dedupe_notification_targets);

-- @find-cutoff
-- 找 cutoff 的唯讀查詢：#281 上線後 SLA 預設通知改成中文標題。
-- 最早一則中文 SLA 通知的時間就是可用的 cutoff；最晚一則英文通知應早於它。
-- 只看 notifications（時間軸事件的內容在 #281 前後沒有可區分的欄位）。
SELECT
  (SELECT min("createdAt") FROM notifications
    WHERE (type, title) IN (
      ('first_response_breached', '首次回應已逾期'),
      ('first_response_warning', '首次回應即將逾期'),
      ('sla_breached', '解決期限已逾期'),
      ('sla_warning', '解決期限即將逾期'),
      ('customer_waiting_breached', '客戶等待過久')
    )) AS "firstChineseAt",
  (SELECT max("createdAt") FROM notifications
    WHERE (type, title) IN (
      ('first_response_breached', 'First response SLA breached'),
      ('first_response_warning', 'First response SLA warning'),
      ('sla_breached', 'Resolution SLA breached'),
      ('sla_warning', 'Resolution SLA warning'),
      ('customer_waiting_breached', 'Customer waiting SLA breached')
    )) AS "lastEnglishAt";
