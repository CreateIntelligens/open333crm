-- Chat 的預設 temperature 改成 0.2，與 DEFAULT_CHAT_SETTINGS 相同（change migrate-ai-llm-tenant-ctx，design D5）。
-- 不更新既有的列：那些列的值可能是成員改過的，無法分辨。
ALTER TABLE "tenant_settings" ALTER COLUMN "chatTemperature" SET DEFAULT 0.2;
