-- 會員綁定的設定驅動介面（OpenSpec add-coupon-system, design D5）
-- 用 JSON 欄位而非開多個欄位：各客戶的會員 API 格式差異大
-- （端點、認證方式、欄位對應、查無會員的判斷依據），開成欄位會無止盡增加。
ALTER TABLE "tenant_settings" ADD COLUMN "memberBinding" JSONB NOT NULL DEFAULT '{}';
