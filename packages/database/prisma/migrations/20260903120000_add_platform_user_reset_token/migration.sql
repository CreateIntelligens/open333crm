-- AlterTable
ALTER TABLE "platform_users" ADD COLUMN     "resetTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "resetTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "platform_users_resetTokenHash_key" ON "platform_users"("resetTokenHash");
