-- CreateTable
CREATE TABLE "case_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caseId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "addedBy" TEXT NOT NULL DEFAULT 'agent',
    "addedById" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "case_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "addedBy" TEXT NOT NULL DEFAULT 'agent',
    "addedById" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_tags_caseId_tagId_key" ON "case_tags"("caseId", "tagId");

-- CreateIndex
CREATE INDEX "case_tags_caseId_idx" ON "case_tags"("caseId");

-- CreateIndex
CREATE INDEX "case_tags_tagId_idx" ON "case_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tags_conversationId_tagId_key" ON "conversation_tags"("conversationId", "tagId");

-- CreateIndex
CREATE INDEX "conversation_tags_conversationId_idx" ON "conversation_tags"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_tags_tagId_idx" ON "conversation_tags"("tagId");

-- AddForeignKey
ALTER TABLE "case_tags" ADD CONSTRAINT "case_tags_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_tags" ADD CONSTRAINT "case_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
