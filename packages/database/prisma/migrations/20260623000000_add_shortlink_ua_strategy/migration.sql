-- AlterTable
ALTER TABLE "short_links" ADD COLUMN     "ogTitle" TEXT,
ADD COLUMN     "ogDescription" TEXT,
ADD COLUMN     "ogImage" TEXT,
ADD COLUMN     "lineChannelId" UUID;

-- AlterTable
ALTER TABLE "click_logs" ADD COLUMN     "lineUid" TEXT;

-- CreateIndex
CREATE INDEX "short_links_lineChannelId_idx" ON "short_links"("lineChannelId");

-- CreateIndex
CREATE INDEX "click_logs_lineUid_idx" ON "click_logs"("lineUid");

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_lineChannelId_fkey" FOREIGN KEY ("lineChannelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
