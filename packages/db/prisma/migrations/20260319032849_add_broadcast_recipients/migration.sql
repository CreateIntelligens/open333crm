-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broadcastId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'sent',
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "firstReplyAt" TIMESTAMP(3),
    "caseId" UUID,
    "caseCreatedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcast_recipients_contactId_sentAt_idx" ON "broadcast_recipients"("contactId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcastId_contactId_key" ON "broadcast_recipients"("broadcastId", "contactId");

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
