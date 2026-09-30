-- 跨渠道 One ID（change add-cross-channel-one-id）：統一合併引擎的合併紀錄 + 綁定代碼歸戶來源。

-- AlterEnum
ALTER TYPE "StitchSource" ADD VALUE IF NOT EXISTS 'BINDING_CODE';
ALTER TYPE "SuggestionStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

-- CreateTable
CREATE TABLE "contact_merge_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "survivorId" UUID NOT NULL,
    "mergedId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "actorAgentId" UUID,
    "movedRecords" JSONB NOT NULL,
    "revertedAt" TIMESTAMP(3),
    "revertedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_merge_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_merge_logs_tenantId_survivorId_idx" ON "contact_merge_logs"("tenantId", "survivorId");
CREATE INDEX "contact_merge_logs_tenantId_mergedId_idx" ON "contact_merge_logs"("tenantId", "mergedId");

ALTER TABLE "contact_merge_logs"
    ADD CONSTRAINT "contact_merge_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS（app_tenant / app_admin 的 CRUD 權限由 20260826160000 的 ALTER DEFAULT PRIVILEGES 自動授予）
ALTER TABLE "contact_merge_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_merge_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contact_merge_logs"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
