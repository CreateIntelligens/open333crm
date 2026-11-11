-- 歸戶驗證（add-coupon-system D12）：顧客本人透過 One ID 登記連結送出手機或 email 時寫入
ALTER TABLE "contacts" ADD COLUMN "identityVerifiedAt" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "identityVerifiedVia" TEXT;
