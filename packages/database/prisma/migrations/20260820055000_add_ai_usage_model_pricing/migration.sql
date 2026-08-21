-- CreateTable
CREATE TABLE "ai_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "feature" TEXT NOT NULL DEFAULT 'unknown',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "candidatesTokens" INTEGER NOT NULL DEFAULT 0,
    "thoughtsTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "usageMissing" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "conversationId" UUID,
    "caseId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_pricings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model" TEXT NOT NULL,
    "inputPer1M" DECIMAL(12,6) NOT NULL,
    "outputPer1M" DECIMAL(12,6) NOT NULL,
    "cachedPer1M" DECIMAL(12,6) NOT NULL,
    "tierThreshold" INTEGER,
    "tierInputPer1M" DECIMAL(12,6),
    "tierOutputPer1M" DECIMAL(12,6),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_pricings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usages_tenantId_createdAt_idx" ON "ai_usages"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usages_tenantId_feature_idx" ON "ai_usages"("tenantId", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "model_pricings_model_effectiveFrom_key" ON "model_pricings"("model", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ai_usages" ADD CONSTRAINT "ai_usages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

