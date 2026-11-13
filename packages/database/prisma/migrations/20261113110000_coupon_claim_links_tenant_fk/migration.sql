-- #362 A3：領券連結的券、渠道必須與連結同一租戶，由資料庫擋下跨租戶寫入。
-- 原本 coupon_claim_links 只有單欄外鍵（couponId → coupons.id、channelId → channels.id），
-- 應用層漏檢查時，A 租戶的連結可以指向 B 租戶的券或渠道。
-- 改成複合外鍵 (couponId, tenantId) → coupons(id, tenantId)、(channelId, tenantId) → channels(id, tenantId)；
-- 被參照的兩欄需要唯一約束，所以 coupons、channels 先加 UNIQUE(id, tenantId)（id 本來就唯一，不影響既有資料）。
-- ON DELETE 行為與原本相同：刪券時連結跟著刪（CASCADE），渠道被連結參照時不能硬刪（RESTRICT）。

-- 先檢查既有資料：有跨租戶的連結就讓 migration 失敗並列出前幾筆，不靜默刪除或改資料。
-- 處理方式：確認每筆連結應屬哪個租戶後手動修正或刪除，再重新執行 migration。
DO $$
DECLARE
  bad_coupon  int;
  bad_channel int;
  sample      text;
BEGIN
  SELECT count(*) INTO bad_coupon
    FROM "coupon_claim_links" l JOIN "coupons" c ON c.id = l."couponId"
   WHERE c."tenantId" <> l."tenantId";
  SELECT count(*) INTO bad_channel
    FROM "coupon_claim_links" l JOIN "channels" ch ON ch.id = l."channelId"
   WHERE ch."tenantId" <> l."tenantId";
  IF bad_coupon > 0 OR bad_channel > 0 THEN
    SELECT string_agg(x.id::text, ', ') INTO sample FROM (
      SELECT l.id FROM "coupon_claim_links" l
        LEFT JOIN "coupons" c ON c.id = l."couponId"
        LEFT JOIN "channels" ch ON ch.id = l."channelId"
       WHERE c."tenantId" <> l."tenantId" OR ch."tenantId" <> l."tenantId"
       ORDER BY l."createdAt"
       LIMIT 10
    ) x;
    RAISE EXCEPTION '[#362 A3] coupon_claim_links 有跨租戶資料：券租戶不符 % 筆、渠道租戶不符 % 筆（前 10 筆連結 id：%）。請先確認並修正這些連結，再重新執行 migration。',
      bad_coupon, bad_channel, sample;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "coupons_id_tenantId_key" ON "coupons"("id", "tenantId");
CREATE UNIQUE INDEX "channels_id_tenantId_key" ON "channels"("id", "tenantId");

-- DropForeignKey
ALTER TABLE "coupon_claim_links" DROP CONSTRAINT "coupon_claim_links_couponId_fkey";
ALTER TABLE "coupon_claim_links" DROP CONSTRAINT "coupon_claim_links_channelId_fkey";

-- AddForeignKey
ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_couponId_tenantId_fkey" FOREIGN KEY ("couponId", "tenantId") REFERENCES "coupons"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "channels"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 回滾：
--   ALTER TABLE "coupon_claim_links" DROP CONSTRAINT "coupon_claim_links_couponId_tenantId_fkey";
--   ALTER TABLE "coupon_claim_links" DROP CONSTRAINT "coupon_claim_links_channelId_tenantId_fkey";
--   ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
--   DROP INDEX "coupons_id_tenantId_key"; DROP INDEX "channels_id_tenantId_key";
