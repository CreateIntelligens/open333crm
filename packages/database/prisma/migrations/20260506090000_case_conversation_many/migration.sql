-- Drop the one-to-one Case/Conversation constraint so one case can be linked
-- from multiple conversations while each conversation keeps a single caseId.
DROP INDEX IF EXISTS "conversations_caseId_key";

CREATE INDEX IF NOT EXISTS "conversations_caseId_idx" ON "conversations"("caseId");
