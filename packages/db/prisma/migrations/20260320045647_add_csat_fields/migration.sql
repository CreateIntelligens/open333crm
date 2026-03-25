-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "csatComment" TEXT,
ADD COLUMN     "csatRespondedAt" TIMESTAMP(3),
ADD COLUMN     "csatSentAt" TIMESTAMP(3);
