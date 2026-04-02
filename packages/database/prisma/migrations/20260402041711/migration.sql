-- CreateEnum
CREATE TYPE "ExecutionState" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('TRIGGER', 'MESSAGE', 'WAIT', 'CONDITION', 'API_FETCH', 'AI_GEN', 'ACTION');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "TemplateViewStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StitchSource" AS ENUM ('LIFF_COOKIE', 'PHONE_MATCH', 'EMAIL_MATCH', 'MANUAL', 'OTP_VERIFIED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChannelType" ADD VALUE 'TELEGRAM';
ALTER TYPE "ChannelType" ADD VALUE 'THREADS';

-- DropForeignKey
ALTER TABLE "agent_team_members" DROP CONSTRAINT "agent_team_members_agentId_fkey";

-- DropForeignKey
ALTER TABLE "agent_team_members" DROP CONSTRAINT "agent_team_members_teamId_fkey";

-- DropForeignKey
ALTER TABLE "channel_identities" DROP CONSTRAINT "channel_identities_channelId_fkey";

-- DropForeignKey
ALTER TABLE "channel_identities" DROP CONSTRAINT "channel_identities_contactId_fkey";

-- DropForeignKey
ALTER TABLE "contact_attributes" DROP CONSTRAINT "contact_attributes_contactId_fkey";

-- DropForeignKey
ALTER TABLE "contact_relations" DROP CONSTRAINT "contact_relations_fromContactId_fkey";

-- DropForeignKey
ALTER TABLE "contact_relations" DROP CONSTRAINT "contact_relations_toContactId_fkey";

-- DropForeignKey
ALTER TABLE "contact_tags" DROP CONSTRAINT "contact_tags_contactId_fkey";

-- DropForeignKey
ALTER TABLE "contact_tags" DROP CONSTRAINT "contact_tags_tagId_fkey";

-- DropIndex
DROP INDEX "broadcasts_tenantId_campaignId_idx";

-- DropIndex
DROP INDEX "tags_tenantId_idx";

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "role" SET DEFAULT 'AGENT';

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "eventType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "scopeId" TEXT,
ADD COLUMN     "scopeType" "ScopeType" NOT NULL DEFAULT 'TENANT',
ADD COLUMN     "stopProcessing" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "trigger" SET DEFAULT '{}',
ALTER COLUMN "actions" SET DEFAULT '[]';

-- AlterTable
ALTER TABLE "broadcasts" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "totalDelivered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalReplied" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalSent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "parentCaseId" UUID;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "teamId" UUID;

-- AlterTable
ALTER TABLE "km_articles" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "teamId" UUID,
ADD COLUMN     "version" TEXT DEFAULT '1.0';

-- AlterTable
ALTER TABLE "messages" ALTER COLUMN "direction" SET DEFAULT 'INBOUND';

-- AlterTable
ALTER TABLE "segments" ADD COLUMN     "conditions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "logic" TEXT NOT NULL DEFAULT 'AND',
ALTER COLUMN "createdById" DROP NOT NULL,
ALTER COLUMN "rules" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tags" ALTER COLUMN "type" SET DEFAULT 'MANUAL',
ALTER COLUMN "scope" SET DEFAULT 'CONTACT',
ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "licenseTeamId" TEXT;

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_team_accesses" (
    "channelId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'full',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" UUID,

    CONSTRAINT "channel_team_accesses_pkey" PRIMARY KEY ("channelId","teamId")
);

-- CreateTable
CREATE TABLE "channel_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channelId" UUID NOT NULL,
    "teamId" UUID,
    "direction" "Direction" NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "feeAmount" DOUBLE PRECISION,
    "feeCurrency" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_relations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fromCaseId" UUID NOT NULL,
    "toCaseId" UUID NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "templateId" UUID NOT NULL,
    "channelType" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "status" "TemplateViewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rich_menus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channelId" UUID NOT NULL,
    "lineRichMenuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chatBarText" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rich_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rich_menu_user_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "richMenuId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rich_menu_user_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rich_menu_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "richMenuId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "lineAliasId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rich_menu_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channelId" UUID NOT NULL,
    "segmentId" UUID,
    "lineAudienceGroupId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL DEFAULT 'upload',
    "size" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audience_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "channelId" UUID NOT NULL,
    "snapshotDate" TEXT NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "blocks" INTEGER NOT NULL DEFAULT 0,
    "targetedReaches" INTEGER NOT NULL DEFAULT 0,
    "demographicsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_flows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "maxStepLimit" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interaction_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interaction_nodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flowId" UUID NOT NULL,
    "nodeType" "NodeType" NOT NULL,
    "label" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" JSONB NOT NULL DEFAULT '{}',
    "nextNodeId" UUID,
    "falseNodeId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "interaction_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "flowId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "status" "ExecutionState" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" UUID,
    "contextVars" JSONB NOT NULL DEFAULT '{}',
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "resumeAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "executionId" UUID NOT NULL,
    "nodeId" UUID,
    "action" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_maps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "uid" TEXT NOT NULL,
    "source" "StitchSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merge_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "primaryContactId" UUID NOT NULL,
    "secondaryContactId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merge_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_team_accesses_teamId_idx" ON "channel_team_accesses"("teamId");

-- CreateIndex
CREATE INDEX "channel_usages_channelId_recordedAt_idx" ON "channel_usages"("channelId", "recordedAt");

-- CreateIndex
CREATE INDEX "channel_usages_teamId_recordedAt_idx" ON "channel_usages"("teamId", "recordedAt");

-- CreateIndex
CREATE INDEX "case_relations_fromCaseId_idx" ON "case_relations"("fromCaseId");

-- CreateIndex
CREATE INDEX "case_relations_toCaseId_idx" ON "case_relations"("toCaseId");

-- CreateIndex
CREATE INDEX "template_views_templateId_channelType_idx" ON "template_views"("templateId", "channelType");

-- CreateIndex
CREATE INDEX "rich_menus_channelId_idx" ON "rich_menus"("channelId");

-- CreateIndex
CREATE INDEX "rich_menu_user_bindings_richMenuId_idx" ON "rich_menu_user_bindings"("richMenuId");

-- CreateIndex
CREATE UNIQUE INDEX "rich_menu_user_bindings_channelId_lineUserId_key" ON "rich_menu_user_bindings"("channelId", "lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "rich_menu_aliases_channelId_lineAliasId_key" ON "rich_menu_aliases"("channelId", "lineAliasId");

-- CreateIndex
CREATE INDEX "audience_groups_channelId_idx" ON "audience_groups"("channelId");

-- CreateIndex
CREATE INDEX "insight_snapshots_channelId_snapshotDate_idx" ON "insight_snapshots"("channelId", "snapshotDate" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "insight_snapshots_channelId_snapshotDate_key" ON "insight_snapshots"("channelId", "snapshotDate");

-- CreateIndex
CREATE INDEX "interaction_flows_tenantId_status_idx" ON "interaction_flows"("tenantId", "status");

-- CreateIndex
CREATE INDEX "interaction_nodes_flowId_idx" ON "interaction_nodes"("flowId");

-- CreateIndex
CREATE INDEX "flow_executions_tenantId_status_idx" ON "flow_executions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "flow_executions_resumeAt_idx" ON "flow_executions"("resumeAt");

-- CreateIndex
CREATE INDEX "flow_executions_contactId_idx" ON "flow_executions"("contactId");

-- CreateIndex
CREATE INDEX "flow_logs_executionId_idx" ON "flow_logs"("executionId");

-- CreateIndex
CREATE INDEX "identity_maps_contactId_idx" ON "identity_maps"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "identity_maps_tenantId_channelType_uid_key" ON "identity_maps"("tenantId", "channelType", "uid");

-- CreateIndex
CREATE INDEX "merge_suggestions_tenantId_status_idx" ON "merge_suggestions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "automation_rules_eventType_idx" ON "automation_rules"("eventType");

-- CreateIndex
CREATE INDEX "km_articles_teamId_idx" ON "km_articles"("teamId");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_team_members" ADD CONSTRAINT "agent_team_members_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_team_members" ADD CONSTRAINT "agent_team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_team_accesses" ADD CONSTRAINT "channel_team_accesses_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_team_accesses" ADD CONSTRAINT "channel_team_accesses_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_usages" ADD CONSTRAINT "channel_usages_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_usages" ADD CONSTRAINT "channel_usages_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_fromContactId_fkey" FOREIGN KEY ("fromContactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_toContactId_fkey" FOREIGN KEY ("toContactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_parentCaseId_fkey" FOREIGN KEY ("parentCaseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_relations" ADD CONSTRAINT "case_relations_fromCaseId_fkey" FOREIGN KEY ("fromCaseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_relations" ADD CONSTRAINT "case_relations_toCaseId_fkey" FOREIGN KEY ("toCaseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_results" ADD CONSTRAINT "automation_action_results_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_views" ADD CONSTRAINT "template_views_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "message_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rich_menu_user_bindings" ADD CONSTRAINT "rich_menu_user_bindings_richMenuId_fkey" FOREIGN KEY ("richMenuId") REFERENCES "rich_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rich_menu_aliases" ADD CONSTRAINT "rich_menu_aliases_richMenuId_fkey" FOREIGN KEY ("richMenuId") REFERENCES "rich_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_activities" ADD CONSTRAINT "portal_activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_flows" ADD CONSTRAINT "interaction_flows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interaction_nodes" ADD CONSTRAINT "interaction_nodes_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "interaction_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "interaction_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_logs" ADD CONSTRAINT "flow_logs_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "flow_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_maps" ADD CONSTRAINT "identity_maps_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_maps" ADD CONSTRAINT "identity_maps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merge_suggestions" ADD CONSTRAINT "merge_suggestions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
