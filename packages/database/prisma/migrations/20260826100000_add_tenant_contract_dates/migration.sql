-- 合約起訖日（純記錄，供平台方管理）。nullable、無 default → 對既有租戶零影響、非破壞性。
ALTER TABLE "tenants" ADD COLUMN "contractStartDate" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "contractEndDate" TIMESTAMP(3);
