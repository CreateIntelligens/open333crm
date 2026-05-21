-- CreateEnum
CREATE TYPE "ChatboxSessionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'REVOKED');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "clientMessageId" TEXT,
ADD COLUMN "sequence" INTEGER;

-- CreateTable
CREATE TABLE "chatbox_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "visitorToken" UUID NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "fingerprintVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "riskLevel" "ChatboxSessionRiskLevel" NOT NULL DEFAULT 'LOW',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chatbox_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_conversationId_sequence_idx" ON "messages"("conversationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_clientMessageId_key" ON "messages"("conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "chatbox_sessions_conversationId_key" ON "chatbox_sessions"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "chatbox_sessions_visitorToken_key" ON "chatbox_sessions"("visitorToken");

-- CreateIndex
CREATE UNIQUE INDEX "chatbox_sessions_tokenDigest_key" ON "chatbox_sessions"("tokenDigest");

-- CreateIndex
CREATE INDEX "chatbox_sessions_tenantId_channelId_idx" ON "chatbox_sessions"("tenantId", "channelId");

-- CreateIndex
CREATE INDEX "chatbox_sessions_expiresAt_idx" ON "chatbox_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "chatbox_sessions_fingerprintHash_idx" ON "chatbox_sessions"("fingerprintHash");

-- AddForeignKey
ALTER TABLE "chatbox_sessions" ADD CONSTRAINT "chatbox_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbox_sessions" ADD CONSTRAINT "chatbox_sessions_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chatbox_sessions" ADD CONSTRAINT "chatbox_sessions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
