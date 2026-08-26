-- requestedBy 改 nullable + FK ON DELETE SET NULL：刪 agent 時保留合規請求記錄（GDPR 審計）

-- DropForeignKey
ALTER TABLE "data_erasure_requests" DROP CONSTRAINT "data_erasure_requests_requestedBy_fkey";

-- DropForeignKey
ALTER TABLE "data_export_requests" DROP CONSTRAINT "data_export_requests_requestedBy_fkey";

-- AlterTable
ALTER TABLE "data_erasure_requests" ALTER COLUMN "requestedBy" DROP NOT NULL;

-- AlterTable
ALTER TABLE "data_export_requests" ALTER COLUMN "requestedBy" DROP NOT NULL;






-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_erasure_requests" ADD CONSTRAINT "data_erasure_requests_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
