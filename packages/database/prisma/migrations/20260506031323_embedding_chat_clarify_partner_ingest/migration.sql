-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "km_articles" ADD COLUMN     "externalDocId" VARCHAR(64),
ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "externalVer" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "spec" JSONB;

-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "chatBaseUrl" TEXT NOT NULL DEFAULT 'http://localhost:11434',
ADD COLUMN     "chatMaxTokens" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "chatModel" TEXT NOT NULL DEFAULT 'qwen2.5:3b',
ADD COLUMN     "chatProvider" TEXT NOT NULL DEFAULT 'ollama',
ADD COLUMN     "chatSystemPrompt" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "chatTemperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
ADD COLUMN     "clarifyMaxAttempts" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "clarifySystemPrompt" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "clarifyThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "embeddingBaseUrl" TEXT NOT NULL DEFAULT 'http://localhost:11434',
ADD COLUMN     "embeddingModel" TEXT NOT NULL DEFAULT 'bge-m3',
ADD COLUMN     "embeddingThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
ADD COLUMN     "embeddingTopK" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "summarizeSystemPrompt" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "km_article_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "articleId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "km_article_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "km_article_attachments_articleId_idx" ON "km_article_attachments"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "km_articles_tenantId_externalDocId_key" ON "km_articles"("tenantId", "externalDocId");

-- AddForeignKey
ALTER TABLE "km_article_attachments" ADD CONSTRAINT "km_article_attachments_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "km_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
