-- 門市與店員核銷台（add-coupon-system A10、design D13）

CREATE TABLE "stores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stores_tenantId_idx" ON "stores"("tenantId");
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "store_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "canRedeem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "passwordVersion" INTEGER NOT NULL DEFAULT 0,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "store_accounts_username_key" ON "store_accounts"("username");
CREATE INDEX "store_accounts_tenantId_idx" ON "store_accounts"("tenantId");
CREATE INDEX "store_accounts_storeId_idx" ON "store_accounts"("storeId");
ALTER TABLE "store_accounts" ADD CONSTRAINT "store_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_accounts" ADD CONSTRAINT "store_accounts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 核銷門市快照
ALTER TABLE "coupon_instances" ADD COLUMN "redeemedStoreId" UUID;
ALTER TABLE "coupon_instances" ADD COLUMN "redeemedStoreName" TEXT;
ALTER TABLE "coupon_instances" ADD COLUMN "redeemedStoreAccount" TEXT;

-- RLS：租戶資料表一律 ENABLE + FORCE，policy 讀 app.current_tenant（見 postgres-rls-tenant-isolation skill）
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['stores', 'store_accounts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t);
  END LOOP;
END $$;
