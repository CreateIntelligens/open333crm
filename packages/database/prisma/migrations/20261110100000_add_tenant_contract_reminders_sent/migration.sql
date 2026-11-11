-- 合約到期提醒的已寄檔位（change add-contract-expiry-reminder）。有 default → 既有租戶視為尚未寄過、非破壞性。
ALTER TABLE "tenants" ADD COLUMN "contractRemindersSent" JSONB NOT NULL DEFAULT '[]';
