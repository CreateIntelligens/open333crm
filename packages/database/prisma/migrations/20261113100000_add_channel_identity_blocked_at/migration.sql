-- 渠道身分記錄封鎖官方帳號的時間（issue #362，change fix-line-follow-unfollow-events）。
-- 收到 unfollow 時寫入，重新 follow 時清空。只新增可為 NULL 的欄位，不回填（既有的封鎖狀態不明）。
ALTER TABLE "channel_identities" ADD COLUMN "blockedAt" TIMESTAMP(3);
