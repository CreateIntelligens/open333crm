-- DropForeignKey
ALTER TABLE "platform_audit_logs" DROP CONSTRAINT "platform_audit_logs_platformUserId_fkey";

-- AlterTable
ALTER TABLE "platform_audit_logs" ALTER COLUMN "platformUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

