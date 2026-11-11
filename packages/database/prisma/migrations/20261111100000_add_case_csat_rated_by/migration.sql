-- change csat-reresolve-decisions-339（issue #339 決定 8）：工單記錄滿意度評分的來源。
--
-- 客服代評與客人自評原本寫在同一欄 csatScore，報表分不出來。新增 csatRatedBy：
--   customer：客人回覆問卷；agent：客服在後台代評。
-- 報表的 CSAT 平均與好評率只算客人自評（csatRatedBy 不是 agent），另外顯示客服代評的筆數。
--
-- 回填：#444（2026-11-04）起，每次評分都寫一筆 case_events（eventType = csat_rated，payload.source 是
-- customer 或 agent）。已評分的工單取最後一筆 csat_rated 的 source。沒有這種事件的舊評分維持 NULL，
-- 報表視為客人自評（修正前也是這樣算）。
-- 可重複執行：只更新 csatRatedBy 仍是 NULL 的列。
--
-- 回滾：ALTER TABLE "cases" DROP COLUMN "csatRatedBy";

-- AlterTable
ALTER TABLE "cases" ADD COLUMN "csatRatedBy" TEXT;

-- @guard
-- cases 與 case_events 都是 FORCE ROW LEVEL SECURITY。執行身分若不能略過 RLS，下面的 UPDATE 讀不到任何列，
-- 回填「成功」但什麼都沒寫，客服代評會被報表算成客人自評。寧可讓 migration 失敗。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION '回填需要能略過 RLS 的資料庫身分（superuser 或 BYPASSRLS），目前是 %。請以 MIGRATE_DATABASE_URL 指向 owner 執行 migrate deploy。', current_user;
  END IF;
END
$$;

-- @backfill
UPDATE "cases" c
SET "csatRatedBy" = e."source"
FROM (
  SELECT DISTINCT ON ("caseId") "caseId", "payload"->>'source' AS "source"
  FROM "case_events"
  WHERE "eventType" = 'csat_rated'
  ORDER BY "caseId", "createdAt" DESC
) e
WHERE c."id" = e."caseId"
  AND c."csatScore" IS NOT NULL
  AND c."csatRatedBy" IS NULL
  AND e."source" IN ('customer', 'agent');
