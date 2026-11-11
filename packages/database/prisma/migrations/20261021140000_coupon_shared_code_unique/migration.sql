-- 同一個租戶的共用碼不可重複（code review 2026-10-21）：原本只在程式先查再寫，兩個請求同時送出會都成功。
-- 共用碼寫入前已去空白並轉大寫；複製券時不帶共用碼，所以不影響複製
CREATE UNIQUE INDEX "coupons_tenantId_sharedCode_key" ON "coupons" ("tenantId", "sharedCode") WHERE "sharedCode" IS NOT NULL;
