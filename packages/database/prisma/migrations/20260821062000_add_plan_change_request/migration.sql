-- CreateTable
CREATE TABLE "plan_change_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "targetPlanSlug" TEXT,
    "topupTokens" INTEGER,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_change_requests_tenantId_status_idx" ON "plan_change_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "plan_change_requests_status_createdAt_idx" ON "plan_change_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

