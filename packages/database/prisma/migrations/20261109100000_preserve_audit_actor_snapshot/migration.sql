-- issue #414：永久刪除成員時保留操作者快照。
-- actorId、requestedBy 的外鍵是 ON DELETE SET NULL，成員被刪除後就查不到是誰。
-- purgeAgent() 在刪除成員之前，於同一個交易把名稱與 email 寫進下列欄位。
-- 新欄位都可為空值，不回填：已經被清成空值的舊紀錄無法回復。
-- 三張表原本就對 app_tenant 有表級授權（SELECT、INSERT、UPDATE、DELETE），新欄位不需另外授權。

-- AlterTable
ALTER TABLE "tenant_audit_logs" ADD COLUMN "actorName" TEXT,
ADD COLUMN "actorEmail" TEXT;

-- AlterTable
ALTER TABLE "data_export_requests" ADD COLUMN "requestedByName" TEXT,
ADD COLUMN "requestedByEmail" TEXT;

-- AlterTable
ALTER TABLE "data_erasure_requests" ADD COLUMN "requestedByName" TEXT,
ADD COLUMN "requestedByEmail" TEXT;
