-- Remove the redundant Case.conversationId column.
ALTER TABLE "cases" DROP COLUMN IF EXISTS "conversationId";
