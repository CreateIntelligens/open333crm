-- 票券連結的點擊歸因（add-coupon-system design D21）
ALTER TABLE "coupon_instances" ADD COLUMN "linkOpenedAt" TIMESTAMP(3);
ALTER TABLE "coupon_instances" ADD COLUMN "linkOpenCount" INTEGER NOT NULL DEFAULT 0;
