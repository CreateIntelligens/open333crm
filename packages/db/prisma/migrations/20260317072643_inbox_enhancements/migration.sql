-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "firstResponseAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "botRepliesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handoffReason" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';
