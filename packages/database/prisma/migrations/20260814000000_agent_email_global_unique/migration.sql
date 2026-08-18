-- DropIndex
DROP INDEX "agents_tenantId_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_key" ON "agents"("email");

