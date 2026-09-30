-- 跨渠道 One ID（change add-cross-channel-one-id）：租戶層的綁定設定，預設關閉（{}）。
ALTER TABLE "tenant_settings" ADD COLUMN "identityBinding" JSONB NOT NULL DEFAULT '{}';
