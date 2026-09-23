-- 標籤名稱的大小寫不敏感唯一性。
--
-- 背景：@@unique([tenantId, name, scope]) 區分大小寫，所以「Sale」與「sale」
-- 在 DB 看來是兩筆不同的列。應用層 registerMaterialTags 已改用
-- mode:'insensitive' 查詢，但那只縮短競態窗口、無法消除——
-- 兩個並行請求同時註冊 Sale 與 sale 時，兩邊都查不到既有列，最後各自
-- INSERT 成功，設定頁就出現兩個看似重複的標籤。
--
-- 用 lower(name) 的 functional unique index 讓 DB 直接擋下，
-- 併發下後到的那筆會撞唯一索引失敗（應用層已有 try/catch 吞掉）。
--
-- ⚠️ 建立前先處理既有的大小寫重複資料，否則索引建不起來。
-- 保留每組的第一筆（createdAt 最早），其餘刪除；
-- 刪除前先把關聯轉移到保留的那筆，避免遺失貼標。
DO $$
DECLARE
  dup RECORD;
  keep_id uuid;
BEGIN
  FOR dup IN
    SELECT "tenantId", lower(name) AS lname, scope, array_agg(id ORDER BY "createdAt") AS ids
    FROM tags
    GROUP BY "tenantId", lower(name), scope
    HAVING count(*) > 1
  LOOP
    keep_id := dup.ids[1];
    -- 關聯轉移到保留的標籤（ON CONFLICT 處理「兩個標籤都貼在同一對象」的情況）
    UPDATE contact_tags SET "tagId" = keep_id
      WHERE "tagId" = ANY(dup.ids[2:]) AND NOT EXISTS (
        SELECT 1 FROM contact_tags ct WHERE ct."contactId" = contact_tags."contactId" AND ct."tagId" = keep_id
      );
    UPDATE case_tags SET "tagId" = keep_id
      WHERE "tagId" = ANY(dup.ids[2:]) AND NOT EXISTS (
        SELECT 1 FROM case_tags ct WHERE ct."caseId" = case_tags."caseId" AND ct."tagId" = keep_id
      );
    UPDATE conversation_tags SET "tagId" = keep_id
      WHERE "tagId" = ANY(dup.ids[2:]) AND NOT EXISTS (
        SELECT 1 FROM conversation_tags ct WHERE ct."conversationId" = conversation_tags."conversationId" AND ct."tagId" = keep_id
      );
    -- 殘餘關聯（上面 NOT EXISTS 擋掉的重複）直接刪除
    DELETE FROM contact_tags WHERE "tagId" = ANY(dup.ids[2:]);
    DELETE FROM case_tags WHERE "tagId" = ANY(dup.ids[2:]);
    DELETE FROM conversation_tags WHERE "tagId" = ANY(dup.ids[2:]);
    DELETE FROM tags WHERE id = ANY(dup.ids[2:]);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tags_tenantId_lower_name_scope_key"
  ON tags ("tenantId", lower(name), scope);
