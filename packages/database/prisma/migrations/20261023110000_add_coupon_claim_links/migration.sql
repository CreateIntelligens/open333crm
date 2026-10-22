-- add-coupon-system A15 15.25（design D30）：公開領券連結。
-- 每張行銷券可建立多個領券連結（各自的名稱、渠道、期間、停用），公開網址 /coupon/claim/{code}。
-- code 全系統唯一：公開網址不帶租戶，入站與公開頁都以代碼找到連結。

-- CreateEnum
CREATE TYPE "CouponClaimLinkStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "coupon_claim_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CouponClaimLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "claimCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupon_claim_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupon_claim_links_code_key" ON "coupon_claim_links"("code");
CREATE INDEX "coupon_claim_links_tenantId_idx" ON "coupon_claim_links"("tenantId");
CREATE INDEX "coupon_claim_links_tenantId_couponId_idx" ON "coupon_claim_links"("tenantId", "couponId");

-- AddForeignKey
ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coupon_claim_links" ADD CONSTRAINT "coupon_claim_links_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS：比照既有券表（20261020110000_add_coupon_system）
ALTER TABLE "coupon_claim_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupon_claim_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "coupon_claim_links"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- 公開領券頁（無登入、無租戶）以代碼找出所屬租戶。只回傳租戶 id，不回傳任何連結或券的資料；
-- 之後的查詢一律在綁定該租戶的交易內進行（RLS 生效）。租戶停用時回 NULL（頁面回 404）。
-- 以 SECURITY DEFINER 執行（比照 20260930110000_release_inactive_channel_account）：
-- owner 若沒有 BYPASSRLS，函式看不到任何列，頁面一律 404（fail-closed）。
-- 回滾：DROP FUNCTION coupon_claim_link_tenant(text);
CREATE OR REPLACE FUNCTION coupon_claim_link_tenant(p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT l."tenantId"
    FROM public.coupon_claim_links l
    JOIN public.tenants t ON t.id = l."tenantId"
   WHERE l.code = p_code
     AND t."isActive" = true
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION coupon_claim_link_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION coupon_claim_link_tenant(text) TO app_tenant, app_admin;
