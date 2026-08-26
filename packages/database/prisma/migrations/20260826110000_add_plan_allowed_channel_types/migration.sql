-- 方案渠道 provider 白名單（ChannelType[] JSON）。default '[]' = 不限制（可用全部渠道類型）。
-- 只擋新建渠道，不影響既有渠道。有 default → 對既有 plan 零影響、非破壞性。
ALTER TABLE "plans" ADD COLUMN "allowedChannelTypes" JSONB NOT NULL DEFAULT '[]';
