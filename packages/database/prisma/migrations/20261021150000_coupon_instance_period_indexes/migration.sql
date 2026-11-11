-- 優惠券成效報表依發出、核銷期間統計：原本只有 tenantId 索引，會掃過租戶所有券。
-- 報表在 5 秒時限的租戶交易內執行，資料量大時需要依期間的索引。
CREATE INDEX "coupon_instances_tenantId_issuedAt_idx" ON "coupon_instances"("tenantId", "issuedAt");
CREATE INDEX "coupon_instances_tenantId_redeemedAt_idx" ON "coupon_instances"("tenantId", "redeemedAt");
