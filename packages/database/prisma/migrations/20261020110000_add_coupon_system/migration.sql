-- 優惠券系統（OpenSpec change: add-coupon-system）
-- 三張新表：coupons（券主檔）／coupon_instances（每張券的生命週期）／coupon_codes（序號包庫存）
-- 皆為新表，無既有資料需回填。

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('DISCOUNT_AMOUNT', 'DISCOUNT_PERCENT', 'GIFT', 'EXCHANGE');
CREATE TYPE "CouponPurpose" AS ENUM ('MARKETING', 'SERVICE');
CREATE TYPE "CouponValidityMode" AS ENUM ('FIXED', 'AFTER_CLAIM', 'AFTER_OPEN');
CREATE TYPE "CouponCodeMode" AS ENUM ('SHARED_CODE', 'UNIQUE_CODE', 'IMPORTED_CODES');
CREATE TYPE "CouponRedeemMode" AS ENUM ('STAFF_CODE', 'STAFF_SCAN', 'SELF');
CREATE TYPE "CouponStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "CouponInstanceStatus" AS ENUM ('ISSUED', 'CLAIMED', 'OPENED', 'REDEEMED', 'EXPIRED', 'REVOKED');
CREATE TYPE "CouponCodeStatus" AS ENUM ('AVAILABLE', 'ASSIGNED');

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT,
    "imageUrl" TEXT,
    "couponType" "CouponType" NOT NULL,
    "purpose" "CouponPurpose" NOT NULL DEFAULT 'MARKETING',
    "discountAmount" INTEGER,
    "discountPercent" INTEGER,
    "validityMode" "CouponValidityMode" NOT NULL DEFAULT 'FIXED',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "afterClaimDays" INTEGER,
    "afterOpenMinutes" INTEGER,
    "codeMode" "CouponCodeMode" NOT NULL DEFAULT 'UNIQUE_CODE',
    "sharedCode" TEXT,
    "codePrefix" TEXT,
    "redeemMode" "CouponRedeemMode" NOT NULL DEFAULT 'STAFF_CODE',
    "staffCode" TEXT,
    "totalLimit" INTEGER,
    "perContactLimit" INTEGER NOT NULL DEFAULT 1,
    "claimTagId" UUID,
    "status" "CouponStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "contactId" UUID,
    "code" TEXT NOT NULL,
    "status" "CouponInstanceStatus" NOT NULL DEFAULT 'ISSUED',
    "claimToken" TEXT,
    "claimTokenExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "issuedVia" TEXT,
    "issuedRefId" TEXT,
    "redeemedBy" UUID,
    "redeemMode" "CouponRedeemMode",
    "redeemChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupon_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CouponCodeStatus" NOT NULL DEFAULT 'AVAILABLE',
    "instanceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupons_tenantId_idx" ON "coupons"("tenantId");
CREATE INDEX "coupons_tenantId_status_idx" ON "coupons"("tenantId", "status");
CREATE INDEX "coupons_tenantId_purpose_status_idx" ON "coupons"("tenantId", "purpose", "status");

-- 領取憑證全域唯一：換券時僅憑 token 查找，不先知道租戶
CREATE UNIQUE INDEX "coupon_instances_claimToken_key" ON "coupon_instances"("claimToken");
CREATE UNIQUE INDEX "coupon_instances_tenantId_code_key" ON "coupon_instances"("tenantId", "code");
CREATE INDEX "coupon_instances_tenantId_idx" ON "coupon_instances"("tenantId");
CREATE INDEX "coupon_instances_tenantId_contactId_status_idx" ON "coupon_instances"("tenantId", "contactId", "status");
CREATE INDEX "coupon_instances_couponId_status_idx" ON "coupon_instances"("couponId", "status");
CREATE INDEX "coupon_instances_tenantId_status_expiresAt_idx" ON "coupon_instances"("tenantId", "status", "expiresAt");

CREATE UNIQUE INDEX "coupon_codes_tenantId_code_key" ON "coupon_codes"("tenantId", "code");
CREATE INDEX "coupon_codes_tenantId_idx" ON "coupon_codes"("tenantId");
CREATE INDEX "coupon_codes_couponId_status_idx" ON "coupon_codes"("couponId", "status");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "coupon_instances" ADD CONSTRAINT "coupon_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_instances" ADD CONSTRAINT "coupon_instances_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_instances" ADD CONSTRAINT "coupon_instances_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "coupon_codes" ADD CONSTRAINT "coupon_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_codes" ADD CONSTRAINT "coupon_codes_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS：券資料皆為租戶資料，比照 20260828091000_rls_agentic_llm
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coupons', 'coupon_instances', 'coupon_codes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;
