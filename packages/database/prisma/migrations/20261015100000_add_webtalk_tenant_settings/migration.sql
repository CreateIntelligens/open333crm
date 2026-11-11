-- change webtalk-multi-tenant：租戶層級的 WebTalk 開關與房間版本。
-- 三個欄位都有預設值，既有資料列直接套用預設：WebTalk 開啟、AI 摘要關閉、房間版本 0。
-- tenant_settings 已啟用 RLS，新增欄位不需要調整 policy。
ALTER TABLE "tenant_settings" ADD COLUMN "webtalkEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenant_settings" ADD COLUMN "webtalkAiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN "webtalkRoomVersion" INTEGER NOT NULL DEFAULT 0;
