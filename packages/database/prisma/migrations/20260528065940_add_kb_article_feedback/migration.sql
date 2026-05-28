-- CreateTable
CREATE TABLE "kb_article_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "messageId" UUID,
    "userQuestion" TEXT,
    "botReply" TEXT,
    "confidence" DOUBLE PRECISION,
    "rating" TEXT NOT NULL DEFAULT 'bad',
    "contactId" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_article_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_article_feedback_tenantId_articleId_idx" ON "kb_article_feedback"("tenantId", "articleId");

-- CreateIndex
CREATE INDEX "kb_article_feedback_tenantId_status_idx" ON "kb_article_feedback"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "km_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
