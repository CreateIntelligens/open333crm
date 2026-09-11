-- CM-173 延伸：agent 直綁渠道（AgentChannelAccess）。
-- 「一個帳號＝一個分店」場景：人員設定直接勾選可用渠道，跳過 team 中介；
-- 與 channel_team_accesses 並存，可見性解析取聯集。

-- CreateTable（照 channel_team_accesses 樣式）
CREATE TABLE "agent_channel_accesses" (
    "channelId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'full',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" UUID,

    CONSTRAINT "agent_channel_accesses_pkey" PRIMARY KEY ("channelId","agentId")
);

-- CreateIndex
CREATE INDEX "agent_channel_accesses_agentId_idx" ON "agent_channel_accesses"("agentId");

-- AddForeignKey
ALTER TABLE "agent_channel_accesses" ADD CONSTRAINT "agent_channel_accesses_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_channel_accesses" ADD CONSTRAINT "agent_channel_accesses_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS：雙 FK 子表（比照 20260827110000 的 case_relations/contact_relations）。
-- 兩個父參照都須屬當前租戶，防止寫出「一端本租戶、另一端他租戶」的關聯（WITH CHECK fail-open）。
-- 父表 channels/agents 已 FORCE；current_tenant 未設時 subquery 回空 → fail-closed。
ALTER TABLE agent_channel_accesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_channel_accesses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_channel_accesses;
CREATE POLICY tenant_isolation ON agent_channel_accesses
  USING ("channelId" IN (SELECT id FROM channels) AND "agentId" IN (SELECT id FROM agents))
  WITH CHECK ("channelId" IN (SELECT id FROM channels) AND "agentId" IN (SELECT id FROM agents));
