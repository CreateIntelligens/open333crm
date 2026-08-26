-- 租戶審計 + GDPR：TenantAuditLog / DataExportRequest / DataErasureRequest 三表。
-- 非破壞性（純新增表），對既有資料零影響。

-- CreateTable
CREATE TABLE "tenant_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "payload" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scope" JSONB,
    "fileKey" TEXT,
    "fileSizeBytes" INTEGER,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_erasure_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'anonymize',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "affected" JSONB,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_erasure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_action_createdAt_idx" ON "tenant_audit_logs"("tenantId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_tenantId_actorId_createdAt_idx" ON "tenant_audit_logs"("tenantId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "data_export_requests_tenantId_createdAt_idx" ON "data_export_requests"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "data_export_requests_tenantId_status_idx" ON "data_export_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "data_erasure_requests_tenantId_createdAt_idx" ON "data_erasure_requests"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "data_erasure_requests_tenantId_status_idx" ON "data_erasure_requests"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

