-- 附券廣播與券詳情頁批次發券（add-coupon-system A15 15.17，design D29、D31）。
-- 既有的 broadcasts、broadcast_recipients 已啟用 RLS，新增欄位沿用原本的 policy，不需新 policy。

-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "couponId" UUID,
ADD COLUMN     "couponIssuedByName" TEXT,
ADD COLUMN     "couponIssuedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "couponIssuedVia" TEXT,
ADD COLUMN     "couponMessage" TEXT,
ADD COLUMN     "failureCode" TEXT;

-- AlterTable
ALTER TABLE "broadcast_recipients" ADD COLUMN     "couponInstanceId" UUID,
ADD COLUMN     "skipReason" TEXT;

-- CreateIndex
CREATE INDEX "broadcasts_tenantId_couponId_idx" ON "broadcasts"("tenantId", "couponId");

