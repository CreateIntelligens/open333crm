-- change fix-meta-webhook-page-routing：FB／IG webhook 改依 entry.id（粉專 ID／IG 專業帳號 ID）分派渠道。
-- 帳號 ID 原本只存在加密的 credentials 內，無法查詢也無法唯一限制，這裡改存明文欄位。
--
-- 唯一索引為全域檢查（不受 RLS 過濾）：同一個粉專／IG 帳號在全平台只能連結一次，跨租戶亦然。
-- 欄位 nullable，既有資料為 NULL，Postgres 唯一索引允許多筆 NULL，建索引不會失敗；
-- 由回填腳本 backfill-channel-external-account-id.ts 補值（衝突者不寫入）。
-- channels 既有的 tenant_isolation RLS policy 以 tenantId 為準，不需調整。
--
-- 回滾：DROP INDEX "channels_channelType_externalAccountId_key"; ALTER TABLE "channels" DROP COLUMN "externalAccountId";
ALTER TABLE "channels" ADD COLUMN "externalAccountId" TEXT;

CREATE UNIQUE INDEX "channels_channelType_externalAccountId_key" ON "channels"("channelType", "externalAccountId");
