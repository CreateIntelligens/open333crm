-- #362 A4：broadcasts.couponId 原本沒有外鍵，刪除草稿券（coupon.service deleteCoupon）後廣播會指向不存在的券。
--
-- ON DELETE SET NULL 的理由：
--   - 只有草稿券能刪（deleteCoupon 只刪 status = DRAFT），已發布、暫停、結束的券都不能刪。
--   - 廣播只能附上進行中的券（assertBroadcastCoupon），券的狀態也不會回到草稿，
--     所以正常流程下不會有廣播指向可以被刪的券；指向草稿券的廣播一張券都沒發過，清成 NULL 不會遺失發券歸因。
--   - 用 RESTRICT 的話，資料異常時刪草稿會變成 500（外鍵錯誤），而刪除流程沒有對應的錯誤訊息。
-- 欄位只用單欄外鍵：複合外鍵 (couponId, tenantId) 的 SET NULL 會連 tenantId（NOT NULL）一起清空而失敗。

-- 先清孤兒：指向不存在的券的廣播改成沒有附券，否則加外鍵會失敗。
UPDATE "broadcasts" b
   SET "couponId" = NULL
 WHERE b."couponId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "coupons" c WHERE c.id = b."couponId");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 回滾：ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_couponId_fkey";（清掉的孤兒 couponId 無法還原，原本就指向不存在的券）
