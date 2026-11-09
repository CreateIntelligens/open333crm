-- 群發記錄排定送出的成員（change require-broadcast-send-permissions，issue #409 MKT-02、MKT-03）。
-- 排程器到期送出前，以這位成員當下的有效權限重新檢查；為 null（舊資料）時退回建立者 createdById。
-- 不加外鍵：成員被永久刪除時排程器查不到人，照「成員不存在」標失敗。
ALTER TABLE "broadcasts" ADD COLUMN "scheduledById" UUID;
