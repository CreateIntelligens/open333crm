-- CreateTable
CREATE TABLE "quick_reply_presets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quick_reply_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quick_reply_presets_tenantId_isActive_idx" ON "quick_reply_presets"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "quick_reply_presets" ADD CONSTRAINT "quick_reply_presets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
