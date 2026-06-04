-- CreateTable
CREATE TABLE "cli_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" VARCHAR(9) NOT NULL,
    "tokenSuffix" VARCHAR(4) NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cli_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cli_sessions_tokenPrefix_idx" ON "cli_sessions"("tokenPrefix");

-- CreateIndex
CREATE INDEX "cli_sessions_tenantId_agentId_idx" ON "cli_sessions"("tenantId", "agentId");

-- CreateIndex
CREATE INDEX "cli_sessions_tenantId_revokedAt_expiresAt_idx" ON "cli_sessions"("tenantId", "revokedAt", "expiresAt");

-- AddForeignKey
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cli_sessions" ADD CONSTRAINT "cli_sessions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
