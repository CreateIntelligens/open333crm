-- 對話發券：顧客第一次從票券連結開啟券的時間（add-coupon-system design D14）
ALTER TABLE "coupon_instances" ADD COLUMN "viewedAt" TIMESTAMP(3);
