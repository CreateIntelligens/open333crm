-- 廣播發送失敗的原因（issue #287）：排程發送失敗時原本只寫 log，後台看不到
ALTER TABLE "broadcasts" ADD COLUMN "failureReason" TEXT;
