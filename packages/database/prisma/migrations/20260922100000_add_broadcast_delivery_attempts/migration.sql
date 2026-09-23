-- Durable retry state for LINE broadcast and multicast API batches.
CREATE TABLE "broadcast_delivery_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "batchIndex" INTEGER NOT NULL,
    "retryKey" UUID NOT NULL,
    "lineRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "broadcast_delivery_attempts_retryKey_key"
    ON "broadcast_delivery_attempts"("retryKey");
CREATE UNIQUE INDEX "broadcast_delivery_attempts_broadcastId_batchIndex_key"
    ON "broadcast_delivery_attempts"("broadcastId", "batchIndex");
CREATE INDEX "broadcast_delivery_attempts_tenantId_broadcastId_idx"
    ON "broadcast_delivery_attempts"("tenantId", "broadcastId");
CREATE INDEX "broadcast_delivery_attempts_tenantId_status_idx"
    ON "broadcast_delivery_attempts"("tenantId", "status");

ALTER TABLE "broadcast_delivery_attempts"
    ADD CONSTRAINT "broadcast_delivery_attempts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "broadcast_delivery_attempts"
    ADD CONSTRAINT "broadcast_delivery_attempts_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "broadcast_delivery_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "broadcast_delivery_attempts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "broadcast_delivery_attempts"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
