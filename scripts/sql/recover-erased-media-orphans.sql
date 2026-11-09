-- scripts/recover-erased-media-orphans.mjs 使用的 SQL（issue #474）。
--
-- 每個 `-- @名稱` 標記一段，一段只放一個語句（Prisma 的 raw 查詢一次只能執行一個語句）。
-- 這些段落只讀資料庫；物件儲存的列出與刪除在腳本裡做。
-- tests/feature/scripts/recover-erased-media-orphans.test.ts 在 owner 交易內執行這些段落後回滾。

-- @guard
-- conversations、messages、data_erasure_requests 都是 FORCE ROW LEVEL SECURITY。執行身分若不能略過 RLS，
-- 查詢會回 0 列，預覽顯示「沒有孤兒檔」但其實是看不到。寧可直接失敗。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION '回收需要能略過 RLS 的資料庫身分（superuser 或 BYPASSRLS），目前是 %。請以 MIGRATE_DATABASE_URL 指向 owner 執行。', current_user;
  END IF;
END
$$;

-- @target-conversations
-- 已完成的匿名化請求的聯絡人，他們目前的對話。匿名化保留對話，進站訊息的 storageKey 已被抹成
-- { redacted: true }，所以媒體檔只能從物件儲存的 {tenantId}/media/{conversationId}/ 目錄找。
-- 參數：$1 逗號分隔的租戶 ID，空字串表示所有租戶。
SELECT DISTINCT r."tenantId"::text AS "tenantId", c.id::text AS "conversationId"
FROM data_erasure_requests r
JOIN conversations c ON c."contactId" = r."contactId" AND c."tenantId" = r."tenantId"
WHERE r.status = 'completed'
  AND r.mode = 'anonymize'
  AND ($1 = '' OR r."tenantId" = ANY (string_to_array($1, ',')::uuid[]))
ORDER BY 1, 2;

-- @hard-delete-requests
-- 已完成的硬刪除請求：對話已經刪除，資料庫找不到它們的媒體目錄，這支腳本不處理（硬刪除本來就會刪媒體檔）。
SELECT r."tenantId"::text AS "tenantId", count(*)::int AS count
FROM data_erasure_requests r
WHERE r.status = 'completed'
  AND r.mode = 'hard_delete'
  AND ($1 = '' OR r."tenantId" = ANY (string_to_array($1, ',')::uuid[]))
GROUP BY r."tenantId"
ORDER BY 1;

-- @referenced-keys
-- 這個租戶的任何訊息仍引用的 key（content 的文字裡出現這個 key：storageKey、url、mediaUrl 都算）。
-- 參數：$1 租戶 ID，$2 候選 key 陣列。
SELECT k AS key
FROM unnest($2::text[]) AS k
WHERE EXISTS (
  SELECT 1
  FROM messages m
  JOIN conversations c ON c.id = m."conversationId"
  WHERE c."tenantId" = $1::uuid
    AND strpos(m.content::text, k) > 0
);
