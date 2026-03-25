-- CreateTable
CREATE TABLE "daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "statType" TEXT NOT NULL,
    "dimensionId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_stats_tenantId_statType_date_idx" ON "daily_stats"("tenantId", "statType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_tenantId_date_statType_dimensionId_key" ON "daily_stats"("tenantId", "date", "statType", "dimensionId");
