-- 群發略過的人數：FB／IG 只能發給 24 小時內互動過的人，視窗外的人不送出（change broadcast-messaging-window）
ALTER TABLE "broadcasts" ADD COLUMN "skippedCount" INTEGER NOT NULL DEFAULT 0;
