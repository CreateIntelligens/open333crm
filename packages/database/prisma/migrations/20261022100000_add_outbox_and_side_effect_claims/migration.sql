-- 事件送達（change outbox-event-delivery，issue #337 階段 1b）：
-- outbox 存交易內登記的事件與佇列 job；side_effect_claims 存副作用的認領紀錄；
-- webhook_deliveries 加 eventId，同一個事件送給同一個訂閱只有一筆紀錄。

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "queueName" TEXT,
    "payload" JSONB NOT NULL,
    "jobOptions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_dispatchedAt_createdAt_idx" ON "outbox"("dispatchedAt", "createdAt");

ALTER TABLE "outbox"
    ADD CONSTRAINT "outbox_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "side_effect_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "subKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "side_effect_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "side_effect_claims_kind_sourceId_subKey_key" ON "side_effect_claims"("kind", "sourceId", "subKey");
CREATE INDEX "side_effect_claims_createdAt_idx" ON "side_effect_claims"("createdAt");

ALTER TABLE "side_effect_claims"
    ADD CONSTRAINT "side_effect_claims_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable：既有資料的 eventId 是 null，唯一鍵不影響它們
ALTER TABLE "webhook_deliveries" ADD COLUMN "eventId" UUID;
CREATE UNIQUE INDEX "webhook_deliveries_subscriptionId_eventId_key" ON "webhook_deliveries"("subscriptionId", "eventId");

-- RLS（app_tenant / app_admin 的 CRUD 權限由 20260826160000 的 ALTER DEFAULT PRIVILEGES 自動授予）
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

ALTER TABLE "side_effect_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "side_effect_claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "side_effect_claims"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
