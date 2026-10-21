-- 對話發券先保留再發送（add-coupon-system design D16）
ALTER TABLE "coupon_instances" ADD COLUMN "deliveryPendingAt" TIMESTAMP(3);

-- 排程只查有值的少數幾列
CREATE INDEX "coupon_instances_deliveryPendingAt_idx" ON "coupon_instances" ("deliveryPendingAt") WHERE "deliveryPendingAt" IS NOT NULL;
