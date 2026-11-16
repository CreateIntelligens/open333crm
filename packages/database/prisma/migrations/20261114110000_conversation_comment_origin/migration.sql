-- change add-comment-keyword-private-reply：conversations 加 originCommentReplyLogId（design D7、D18）。
-- 顧客第一次回覆留言私訊時建立／沿用的對話，指向那筆觸發紀錄，收件匣「來自留言」標記與日後篩選用。
-- 欄位 nullable、沒有預設值：PostgreSQL 16 只改目錄、不重寫表。部分索引建立時欄位全為 NULL，仍要掃一次表並短暫擋寫入；
-- 部署前先查 conversations 列數（SELECT reltuples FROM pg_class WHERE relname = 'conversations'），超過 100 萬列時
-- 改用另一支 migration 執行 CREATE INDEX CONCURRENTLY。
-- conversations 已有 RLS，不必動 policy；外鍵檢查不受 RLS 影響。
--
-- 回滾（程式回滾不必執行：舊程式忽略這個 nullable 欄位）：
--   DROP INDEX IF EXISTS "conversations_originCommentReplyLogId_idx";
--   ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_originCommentReplyLogId_fkey";
--   ALTER TABLE "conversations" DROP COLUMN IF EXISTS "originCommentReplyLogId";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "originCommentReplyLogId" UUID;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_originCommentReplyLogId_fkey" FOREIGN KEY ("originCommentReplyLogId") REFERENCES "comment_reply_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 部分索引（Prisma 不支援，schema 以註解標示）
CREATE INDEX "conversations_originCommentReplyLogId_idx"
  ON "conversations" ("originCommentReplyLogId") WHERE "originCommentReplyLogId" IS NOT NULL;
