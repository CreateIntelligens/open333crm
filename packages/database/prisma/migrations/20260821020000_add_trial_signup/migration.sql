-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialRemindersSent" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "trial_signups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_verification',
    "verifyTokenHash" TEXT,
    "verifyTokenExpiresAt" TIMESTAMP(3),
    "verifySentCount" INTEGER NOT NULL DEFAULT 0,
    "lastVerifySentAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "tenantId" UUID,
    "provisionedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_signups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trial_signups_emailNormalized_key" ON "trial_signups"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "trial_signups_verifyTokenHash_key" ON "trial_signups"("verifyTokenHash");

