-- change add-comment-keyword-private-reply：FB／IG 留言關鍵字自動私訊的 4 張租戶表（design「資料模型」、D7～D11）。
--   comment_reply_rules   規則（軟刪除 deletedAt）
--   comment_authors       留言者（webhook from.id）→ 聯絡人、PSID 對應
--   comment_reply_logs    觸發紀錄（只記命中規則的留言）
--   comment_reply_usages  每月（台灣時間 YYYY-MM）私訊用量計數
--
-- 外鍵：渠道、規則、留言者用 (xxxId, tenantId) 複合外鍵。外鍵檢查不受 RLS 影響，單欄外鍵會讓 A 租戶的列指向
-- B 租戶的渠道／規則／留言者，複合外鍵在資料庫層擋下（比照 #362 A3 的 coupon_claim_links）。
-- 刪除行為（design「刪除行為」）：渠道硬刪 → 規則、留言者 CASCADE，紀錄 RESTRICT；素材刪除 → 規則 materialId SET NULL；
-- 聯絡人硬刪 → 留言者 CASCADE，但紀錄對留言者 RESTRICT（data-erasure 必須先刪紀錄）；對話硬刪 → 紀錄 conversationId SET NULL。
--
-- 回滾（程式回滾不必刪表：新表沒有舊程式在讀。整個功能下架時另寫 forward migration，先匯出紀錄、先把 feed 從粉專訂閱拿掉）：
--   先回滾 20261114110000_conversation_comment_origin（conversations 參照 comment_reply_logs）
--   DROP TABLE IF EXISTS "comment_reply_logs";
--   DROP TABLE IF EXISTS "comment_authors";
--   DROP TABLE IF EXISTS "comment_reply_rules";
--   DROP TABLE IF EXISTS "comment_reply_usages";
--   DROP TYPE IF EXISTS "CommentReplyStatus";
--   （DROP TABLE 會一併移除索引、外鍵、policy 與 GRANT）

-- CreateEnum
CREATE TYPE "CommentReplyStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED', 'SKIPPED_DUPLICATE');

-- CreateTable
CREATE TABLE "comment_reply_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "keywords" TEXT[],
    "matchMode" TEXT NOT NULL DEFAULT 'any',
    "postScope" TEXT NOT NULL DEFAULT 'all',
    "postIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postSnapshots" JSONB NOT NULL DEFAULT '[]',
    "contentType" TEXT NOT NULL,
    "materialId" UUID,
    "messageText" TEXT,
    "dedupePerCommenter" BOOLEAN NOT NULL DEFAULT true,
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicReplyTexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "comment_reply_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_authors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "username" TEXT,
    "contactId" UUID NOT NULL,
    "createdContact" BOOLEAN NOT NULL DEFAULT false,
    "contactEventPublishedAt" TIMESTAMP(3),
    "psid" TEXT,
    "firstCommentAt" TIMESTAMP(3) NOT NULL,
    "lastCommentAt" TIMESTAMP(3) NOT NULL,
    "commentCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "comment_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reply_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "commentAuthorId" UUID NOT NULL,
    "conversationId" UUID,
    "commentId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "adId" TEXT,
    "commenterId" TEXT,
    "commenterName" TEXT,
    "commenterUsername" TEXT,
    "commentText" TEXT,
    "commentCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAtSource" TEXT NOT NULL DEFAULT 'comment',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "CommentReplyStatus" NOT NULL DEFAULT 'PENDING',
    "reasonCode" TEXT,
    "reasonMessage" TEXT,
    "metaErrorCode" INTEGER,
    "metaErrorSubcode" INTEGER,
    "metaTraceId" TEXT,
    "dedupeKey" TEXT,
    "holderLogId" UUID,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "metaRateLimitHits" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "quotaMonth" CHAR(7),
    "sendAttemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentMessageId" TEXT,
    "recipientUid" TEXT,
    "sentContentSnapshot" JSONB,
    "publicReplyStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "publicReplyText" TEXT,
    "publicReplyCommentId" TEXT,
    "publicReplyReasonCode" TEXT,
    "publicReplyAt" TIMESTAMP(3),
    "customerRepliedAt" TIMESTAMP(3),
    "commentDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "comment_reply_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_reply_usages" (
    "tenantId" UUID NOT NULL,
    "month" CHAR(7) NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "publicReplyCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "comment_reply_usages_pkey" PRIMARY KEY ("tenantId","month")
);

-- CreateIndex
CREATE INDEX "comment_reply_rules_tenantId_channelId_priority_idx" ON "comment_reply_rules"("tenantId", "channelId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "comment_reply_rules_id_tenantId_key" ON "comment_reply_rules"("id", "tenantId");

-- CreateIndex
CREATE INDEX "comment_authors_contactId_idx" ON "comment_authors"("contactId");

-- CreateIndex
CREATE INDEX "comment_authors_tenantId_idx" ON "comment_authors"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "comment_authors_id_tenantId_key" ON "comment_authors"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "comment_authors_channelId_externalUserId_key" ON "comment_authors"("channelId", "externalUserId");

-- CreateIndex
CREATE INDEX "comment_reply_logs_tenantId_commentCreatedAt_id_idx" ON "comment_reply_logs"("tenantId", "commentCreatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "comment_reply_logs_tenantId_status_createdAt_idx" ON "comment_reply_logs"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "comment_reply_logs_channelId_createdAt_idx" ON "comment_reply_logs"("channelId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "comment_reply_logs_ruleId_createdAt_idx" ON "comment_reply_logs"("ruleId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "comment_reply_logs_commentAuthorId_idx" ON "comment_reply_logs"("commentAuthorId");

-- CreateIndex
CREATE INDEX "comment_reply_logs_createdAt_idx" ON "comment_reply_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "comment_reply_logs_channelId_commentId_key" ON "comment_reply_logs"("channelId", "commentId");

-- AddForeignKey
ALTER TABLE "comment_reply_rules" ADD CONSTRAINT "comment_reply_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_rules" ADD CONSTRAINT "comment_reply_rules_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "channels"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_rules" ADD CONSTRAINT "comment_reply_rules_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_authors" ADD CONSTRAINT "comment_authors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_authors" ADD CONSTRAINT "comment_authors_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "channels"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_authors" ADD CONSTRAINT "comment_authors_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_logs" ADD CONSTRAINT "comment_reply_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_logs" ADD CONSTRAINT "comment_reply_logs_channelId_tenantId_fkey" FOREIGN KEY ("channelId", "tenantId") REFERENCES "channels"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_logs" ADD CONSTRAINT "comment_reply_logs_ruleId_tenantId_fkey" FOREIGN KEY ("ruleId", "tenantId") REFERENCES "comment_reply_rules"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_logs" ADD CONSTRAINT "comment_reply_logs_commentAuthorId_tenantId_fkey" FOREIGN KEY ("commentAuthorId", "tenantId") REFERENCES "comment_authors"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_logs" ADD CONSTRAINT "comment_reply_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_reply_usages" ADD CONSTRAINT "comment_reply_usages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 部分索引（Prisma 不支援，schema 以註解標示）──────────────────────────────

-- 收件比對只讀啟用中、未刪除的規則
CREATE INDEX "comment_reply_rules_active_channel_idx"
  ON "comment_reply_rules" ("channelId") WHERE "isActive" AND "deletedAt" IS NULL;

-- 留言者私訊成功後以 recipient_id（PSID）接上；同一渠道一個 PSID 只對應一位留言者
CREATE UNIQUE INDEX "comment_authors_channelId_psid_key"
  ON "comment_authors" ("channelId", "psid") WHERE "psid" IS NOT NULL;

-- D10「同一位留言者只私訊一次」：送出時才佔名額，只在 SENDING／SENT 生效；FAILED、EXPIRED、PENDING 不佔
CREATE UNIQUE INDEX "comment_reply_logs_dedupeKey_active_key"
  ON "comment_reply_logs" ("dedupeKey")
  WHERE "dedupeKey" IS NOT NULL AND "status" IN ('SENDING', 'SENT');

-- comment-reply-recover 排程：找排隊中、到時間要重排的紀錄
CREATE INDEX "comment_reply_logs_pending_idx"
  ON "comment_reply_logs" ((coalesce("nextAttemptAt", "updatedAt"))) WHERE "status" = 'PENDING';

-- D9 當機復原：找 SENDING 超過 2 分鐘的紀錄
CREATE INDEX "comment_reply_logs_sending_idx"
  ON "comment_reply_logs" ("sendAttemptedAt") WHERE "status" = 'SENDING';

-- D18 顧客第一次回覆私訊時補入收件匣：依渠道＋recipient_id 找尚未關聯對話的已送出紀錄
CREATE INDEX "comment_reply_logs_unlinked_recipient_idx"
  ON "comment_reply_logs" ("channelId", "recipientUid", "sentAt" DESC)
  WHERE "status" = 'SENT' AND "conversationId" IS NULL;

-- ── RLS 與權限 ──────────────────────────────────────────────────────────────
-- 4 張表都直接帶 tenantId，用標準 tenant_isolation policy（NULLIF 防空字串轉 uuid 錯誤，RLS skill 陷阱 5）。
-- 20261103110000_revoke_app_tenant_platform_tables 之後預設權限不再授權 app_tenant，新租戶表一定要明確 GRANT；
-- 漏寫時租戶路徑回 42501 permission denied（platform-table-grants.test.ts 會抓到）。app_admin 仍由預設權限自動授權。
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['comment_reply_rules', 'comment_authors', 'comment_reply_logs', 'comment_reply_usages']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
      WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid)$p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
