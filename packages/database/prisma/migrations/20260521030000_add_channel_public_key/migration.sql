-- AlterTable
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "publicKey" TEXT;

UPDATE "channels"
SET "publicKey" = CONCAT('ch_', REPLACE(gen_random_uuid()::text, '-', ''))
WHERE "publicKey" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "channels_publicKey_key" ON "channels"("publicKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channels_publicKey_idx" ON "channels"("publicKey");
