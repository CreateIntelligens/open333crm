-- 平台訊息 id 去重：IG/FB 等會重複投遞同一 webhook，靠此 unique 約束擋掉併發重複建立。
-- channelMsgId 可為 NULL（WebChat 等無此欄位），Postgres unique index 對 NULL 不視為衝突，故安全。
-- 部署前請確認同一 conversation 無重複 channelMsgId：
--   SELECT "conversationId","channelMsgId",COUNT(*) FROM messages
--   WHERE "channelMsgId" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1;
CREATE UNIQUE INDEX "messages_conversationId_channelMsgId_key" ON "messages"("conversationId", "channelMsgId");
