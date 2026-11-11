-- add-coupon-system A15 15.13（design D28）：記錄每個渠道身分加入好友的時間與次數。
-- 加好友禮只發給「第一次加入」：firstFollowedAt 沒有值時，這次 follow 才算第一次。
--
-- 回填：本功能上線前就存在的 LINE 渠道身分視為已加入過（firstFollowedAt = linkedAt），
-- 這些顧客封鎖後再加入不會被當成第一次而領到加好友禮。其他渠道沒有 follow 事件，不回填。
-- lastFollowedAt 與 followCount 不回填：系統沒有上線前的加入紀錄，不推定。
-- 殘留風險見 design D28：上線前只傳過訊息、從未加好友的人，第一次真正加好友時拿不到加好友禮。
--
-- 可重複執行：只更新 firstFollowedAt 還沒有值的列。

-- AlterTable
ALTER TABLE "channel_identities" ADD COLUMN "firstFollowedAt" TIMESTAMP(3),
ADD COLUMN "lastFollowedAt" TIMESTAMP(3),
ADD COLUMN "followCount" INTEGER NOT NULL DEFAULT 0;

-- @guard
-- channel_identities 是 FORCE ROW LEVEL SECURITY。執行身分若不能略過 RLS，下面的 UPDATE 會更新 0 列，
-- 回填「成功」但什麼都沒寫，上線前就是好友的顧客封鎖再加入時會被當成第一次而領到加好友禮。寧可讓 migration 失敗。
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
UPDATE "channel_identities"
SET "firstFollowedAt" = "linkedAt"
WHERE "channelType" = 'LINE' AND "firstFollowedAt" IS NULL;
