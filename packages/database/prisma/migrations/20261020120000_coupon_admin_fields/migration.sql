-- 優惠券後台第一階段（add-coupon-system A8）
-- 草稿只需券名：券型、用途、效期模式、序號模式、核銷方式改為可留空，發布時由 service 檢查
ALTER TABLE "coupons" ALTER COLUMN "couponType" DROP NOT NULL;
ALTER TABLE "coupons" ALTER COLUMN "purpose" DROP NOT NULL;
ALTER TABLE "coupons" ALTER COLUMN "purpose" DROP DEFAULT;
ALTER TABLE "coupons" ALTER COLUMN "validityMode" DROP NOT NULL;
ALTER TABLE "coupons" ALTER COLUMN "validityMode" DROP DEFAULT;
ALTER TABLE "coupons" ALTER COLUMN "codeMode" DROP NOT NULL;
ALTER TABLE "coupons" ALTER COLUMN "codeMode" DROP DEFAULT;
ALTER TABLE "coupons" ALTER COLUMN "redeemMode" DROP NOT NULL;
ALTER TABLE "coupons" ALTER COLUMN "redeemMode" DROP DEFAULT;

-- 券型面額欄位
ALTER TABLE "coupons" ADD COLUMN "minSpend" INTEGER;
ALTER TABLE "coupons" ADD COLUMN "percentCap" INTEGER;
ALTER TABLE "coupons" ADD COLUMN "giftName" TEXT;
ALTER TABLE "coupons" ADD COLUMN "giftQty" INTEGER;
ALTER TABLE "coupons" ADD COLUMN "exchangeItem" TEXT;
ALTER TABLE "coupons" ADD COLUMN "exchangeValueCap" INTEGER;

-- 防濫用與自動化
ALTER TABLE "coupons" ADD COLUMN "claimTagTtlDays" INTEGER;
ALTER TABLE "coupons" ADD COLUMN "maskCodeBeforeStart" BOOLEAN NOT NULL DEFAULT true;

-- 券號：既有的券以 id 雜湊回填，再加上非空與租戶內唯一
ALTER TABLE "coupons" ADD COLUMN "displayCode" TEXT;
UPDATE "coupons" SET "displayCode" = 'CP-' || upper(substr(md5("id"::text), 1, 6)) WHERE "displayCode" IS NULL;
ALTER TABLE "coupons" ALTER COLUMN "displayCode" SET NOT NULL;
CREATE UNIQUE INDEX "coupons_tenantId_displayCode_key" ON "coupons"("tenantId", "displayCode");

-- 發放來源快照
ALTER TABLE "coupon_instances" ADD COLUMN "issuedSourceName" TEXT;
ALTER TABLE "coupon_instances" ADD COLUMN "issuedByName" TEXT;
