-- 試用租戶保留期屆滿軟刪標記（nullable、無 default → 非破壞性，對既有租戶零影響）。
ALTER TABLE "tenants" ADD COLUMN "purgedAt" TIMESTAMP(3);
