-- AlterTable: handoff fallback + sentiment-driven handoff toggle
ALTER TABLE "tenant_settings"
  ADD COLUMN "sentimentTriggersHandoff" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "handoffFallbackAgentId" UUID,
  ADD COLUMN "handoffFallbackTeamId" UUID;
