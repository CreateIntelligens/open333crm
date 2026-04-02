/*
  Warnings:

  - The values [TELEGRAM,THREADS] on the enum `ChannelType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `completedAt` on the `broadcasts` table. All the data in the column will be lost.
  - You are about to drop the column `startedAt` on the `broadcasts` table. All the data in the column will be lost.
  - You are about to drop the column `totalDelivered` on the `broadcasts` table. All the data in the column will be lost.
  - You are about to drop the column `totalReplied` on the `broadcasts` table. All the data in the column will be lost.
  - You are about to drop the column `totalSent` on the `broadcasts` table. All the data in the column will be lost.
  - The `status` column on the `broadcasts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `teamId` on the `conversations` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `km_articles` table. All the data in the column will be lost.
  - You are about to drop the column `teamId` on the `km_articles` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `km_articles` table. All the data in the column will be lost.
  - You are about to drop the column `conditions` on the `segments` table. All the data in the column will be lost.
  - You are about to drop the column `logic` on the `segments` table. All the data in the column will be lost.
  - You are about to drop the column `licenseTeamId` on the `teams` table. All the data in the column will be lost.
  - You are about to drop the `channel_team_accesses` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `channel_usages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `marketing_campaigns` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[tenantId,email]` on the table `agents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,name,scope]` on the table `tags` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tenantId` to the `agents` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `automation_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `automation_rules` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `broadcasts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `broadcasts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `broadcasts` table without a default value. This is not possible if the table is not empty.
  - Made the column `templateId` on table `broadcasts` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `tenantId` to the `cases` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `channels` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `contacts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `conversations` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `km_articles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `segments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rules` to the `segments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `segments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `sla_policies` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `tags` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `teams` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `webhook_subscriptions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `webhook_subscriptions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PortalActivityType" AS ENUM ('POLL', 'FORM', 'QUIZ');

-- CreateEnum
CREATE TYPE "PortalActivityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('TENANT', 'TEAM', 'CHANNEL');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ActionResultStatus" AS ENUM ('SUCCESS', 'FAILED', 'ROLLED_BACK');

-- AlterEnum
BEGIN;
CREATE TYPE "ChannelType_new" AS ENUM ('LINE', 'FB', 'WEBCHAT', 'WHATSAPP');
ALTER TABLE "channels" ALTER COLUMN "channelType" TYPE "ChannelType_new" USING ("channelType"::text::"ChannelType_new");
ALTER TABLE "channel_identities" ALTER COLUMN "channelType" TYPE "ChannelType_new" USING ("channelType"::text::"ChannelType_new");
ALTER TABLE "conversations" ALTER COLUMN "channelType" TYPE "ChannelType_new" USING ("channelType"::text::"ChannelType_new");
ALTER TYPE "ChannelType" RENAME TO "ChannelType_old";
ALTER TYPE "ChannelType_new" RENAME TO "ChannelType";
DROP TYPE "public"."ChannelType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "agent_team_members" DROP CONSTRAINT "agent_team_members_agentId_fkey";

-- DropForeignKey
ALTER TABLE "agent_team_members" DROP CONSTRAINT "agent_team_members_teamId_fkey";

-- DropForeignKey
ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "channel_identities" DROP CONSTRAINT "channel_identities_channelId_fkey";

-- DropForeignKey
ALTER TABLE "channel_identities" DROP CONSTRAINT "channel_identities_contactId_fkey";

-- DropForeignKey
ALTER TABLE "channel_team_accesses" DROP CONSTRAINT "channel_team_accesses_channelId_fkey";

-- DropForeignKey
ALTER TABLE "channel_team_accesses" DROP CONSTRAINT "channel_team_accesses_teamId_fkey";

-- DropForeignKey
ALTER TABLE "channel_usages" DROP CONSTRAINT "channel_usages_channelId_fkey";

-- DropForeignKey
ALTER TABLE "channel_usages" DROP CONSTRAINT "channel_usages_teamId_fkey";

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

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_teamId_fkey";

-- DropIndex
DROP INDEX "agents_email_key";

-- DropIndex
DROP INDEX "automation_logs_createdAt_idx";

-- DropIndex
DROP INDEX "automation_rules_isActive_idx";

-- DropIndex
DROP INDEX "broadcasts_status_idx";

-- DropIndex
DROP INDEX "cases_assigneeId_idx";

-- DropIndex
DROP INDEX "cases_slaDueAt_idx";

-- DropIndex
DROP INDEX "cases_status_idx";

-- DropIndex
DROP INDEX "contacts_email_idx";

-- DropIndex
DROP INDEX "contacts_phone_idx";

-- DropIndex
DROP INDEX "conversations_contactId_idx";

-- DropIndex
DROP INDEX "conversations_lastMessageAt_idx";

-- DropIndex
DROP INDEX "conversations_status_idx";

-- DropIndex
DROP INDEX "km_articles_status_idx";

-- DropIndex
DROP INDEX "km_articles_teamId_idx";

-- DropIndex
DROP INDEX "tags_name_scope_key";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "tenantId" UUID NOT NULL,
ALTER COLUMN "role" DROP DEFAULT;

-- AlterTable
ALTER TABLE "automation_logs" ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "automation_rules" ADD COLUMN     "description" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stopOnMatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tenantId" UUID NOT NULL,
ALTER COLUMN "conditions" SET DEFAULT '{}';

-- AlterTable
ALTER TABLE "broadcasts" DROP COLUMN "completedAt",
DROP COLUMN "startedAt",
DROP COLUMN "totalDelivered",
DROP COLUMN "totalReplied",
DROP COLUMN "totalSent",
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "successCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "targetConfig" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "targetType" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "totalCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "templateId" SET NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "csatComment" TEXT,
ADD COLUMN     "csatRespondedAt" TIMESTAMP(3),
ADD COLUMN     "csatSentAt" TIMESTAMP(3),
ADD COLUMN     "firstResponseAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "teamId",
ADD COLUMN     "botRepliesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handoffReason" TEXT,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "km_articles" DROP COLUMN "metadata",
DROP COLUMN "teamId",
DROP COLUMN "version",
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "tenantId" UUID;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "direction" DROP DEFAULT;

-- AlterTable
ALTER TABLE "segments" DROP COLUMN "conditions",
DROP COLUMN "logic",
ADD COLUMN     "contactCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "rules" JSONB NOT NULL,
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "sla_policies" ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "tenantId" UUID NOT NULL,
ALTER COLUMN "type" DROP DEFAULT,
ALTER COLUMN "scope" DROP DEFAULT;

-- AlterTable
ALTER TABLE "teams" DROP COLUMN "licenseTeamId",
ADD COLUMN     "tenantId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "webhook_subscriptions" ADD COLUMN     "tenantId" UUID NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- DropTable
DROP TABLE "channel_team_accesses";

-- DropTable
DROP TABLE "channel_usages";

-- DropTable
DROP TABLE "marketing_campaigns";

-- DropEnum
DROP TYPE "BroadcastStatus";

-- DropEnum
DROP TYPE "CampaignStatus";

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventId" TEXT,
    "factSnapshot" JSONB NOT NULL,
    "candidateRuleIds" TEXT[],
    "matchedRuleIds" TEXT[],
    "actionsExecuted" JSONB NOT NULL,
    "stoppedAt" TEXT,
    "status" "ExecutionStatus" NOT NULL,
    "ruleId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_action_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "actionType" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "beforeSnapshot" JSONB,
    "afterSnapshot" JSONB,
    "status" "ActionResultStatus" NOT NULL,
    "errorMessage" TEXT,
    "rollbackable" BOOLEAN NOT NULL DEFAULT false,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_action_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clickUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "statType" TEXT NOT NULL,
    "dimensionId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
    "officeHours" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscriptionId" UUID NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "type" "PortalActivityType" NOT NULL,
    "status" "PortalActivityStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverImage" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activityId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "portal_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_fields" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activityId" UUID NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB NOT NULL DEFAULT '[]',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "portal_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activityId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "refId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "title" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "tagOnClick" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "totalClicks" INTEGER NOT NULL DEFAULT 0,
    "uniqueClicks" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shortLinkId" UUID NOT NULL,
    "contactId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "click_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_executions_tenantId_idx" ON "automation_executions"("tenantId");

-- CreateIndex
CREATE INDEX "automation_executions_status_idx" ON "automation_executions"("status");

-- CreateIndex
CREATE INDEX "automation_executions_eventType_idx" ON "automation_executions"("eventType");

-- CreateIndex
CREATE INDEX "automation_action_results_executionId_idx" ON "automation_action_results"("executionId");

-- CreateIndex
CREATE INDEX "notifications_agentId_isRead_idx" ON "notifications"("agentId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_agentId_createdAt_idx" ON "notifications"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "daily_stats_tenantId_statType_date_idx" ON "daily_stats"("tenantId", "statType", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_tenantId_date_statType_dimensionId_key" ON "daily_stats"("tenantId", "date", "statType", "dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");

-- CreateIndex
CREATE INDEX "campaigns_tenantId_status_idx" ON "campaigns"("tenantId", "status");

-- CreateIndex
CREATE INDEX "broadcast_recipients_contactId_sentAt_idx" ON "broadcast_recipients"("contactId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcastId_contactId_key" ON "broadcast_recipients"("broadcastId", "contactId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscriptionId_createdAt_idx" ON "webhook_deliveries"("subscriptionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "portal_activities_tenantId_status_idx" ON "portal_activities"("tenantId", "status");

-- CreateIndex
CREATE INDEX "portal_activities_tenantId_type_idx" ON "portal_activities"("tenantId", "type");

-- CreateIndex
CREATE INDEX "portal_submissions_activityId_contactId_idx" ON "portal_submissions"("activityId", "contactId");

-- CreateIndex
CREATE INDEX "point_transactions_tenantId_contactId_idx" ON "point_transactions"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "point_transactions_contactId_createdAt_idx" ON "point_transactions"("contactId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "short_links_slug_key" ON "short_links"("slug");

-- CreateIndex
CREATE INDEX "short_links_tenantId_idx" ON "short_links"("tenantId");

-- CreateIndex
CREATE INDEX "short_links_slug_idx" ON "short_links"("slug");

-- CreateIndex
CREATE INDEX "click_logs_shortLinkId_createdAt_idx" ON "click_logs"("shortLinkId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "click_logs_contactId_idx" ON "click_logs"("contactId");

-- CreateIndex
CREATE INDEX "agents_tenantId_idx" ON "agents"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_tenantId_email_key" ON "agents"("tenantId", "email");

-- CreateIndex
CREATE INDEX "automation_logs_tenantId_createdAt_idx" ON "automation_logs"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "automation_rules_tenantId_isActive_idx" ON "automation_rules"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "broadcasts_tenantId_status_idx" ON "broadcasts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "broadcasts_tenantId_campaignId_idx" ON "broadcasts"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "broadcasts_status_scheduledAt_idx" ON "broadcasts"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "cases_tenantId_status_idx" ON "cases"("tenantId", "status");

-- CreateIndex
CREATE INDEX "cases_tenantId_assigneeId_idx" ON "cases"("tenantId", "assigneeId");

-- CreateIndex
CREATE INDEX "cases_tenantId_slaDueAt_idx" ON "cases"("tenantId", "slaDueAt");

-- CreateIndex
CREATE INDEX "channels_tenantId_idx" ON "channels"("tenantId");

-- CreateIndex
CREATE INDEX "contacts_tenantId_idx" ON "contacts"("tenantId");

-- CreateIndex
CREATE INDEX "contacts_tenantId_phone_idx" ON "contacts"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "contacts_tenantId_email_idx" ON "contacts"("tenantId", "email");

-- CreateIndex
CREATE INDEX "conversations_tenantId_status_idx" ON "conversations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "conversations_tenantId_contactId_idx" ON "conversations"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "conversations_tenantId_lastMessageAt_idx" ON "conversations"("tenantId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "km_articles_tenantId_status_idx" ON "km_articles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "message_templates_tenantId_idx" ON "message_templates"("tenantId");

-- CreateIndex
CREATE INDEX "segments_tenantId_idx" ON "segments"("tenantId");

-- CreateIndex
CREATE INDEX "sla_policies_tenantId_idx" ON "sla_policies"("tenantId");

-- CreateIndex
CREATE INDEX "tags_tenantId_idx" ON "tags"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_name_scope_key" ON "tags"("tenantId", "name", "scope");

-- CreateIndex
CREATE INDEX "teams_tenantId_idx" ON "teams"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_tenantId_isActive_idx" ON "webhook_subscriptions"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "agent_team_members" ADD CONSTRAINT "agent_team_members_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_team_members" ADD CONSTRAINT "agent_team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_fromContactId_fkey" FOREIGN KEY ("fromContactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_relations" ADD CONSTRAINT "contact_relations_toContactId_fkey" FOREIGN KEY ("toContactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_results" ADD CONSTRAINT "automation_action_results_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_options" ADD CONSTRAINT "portal_options_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "portal_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_fields" ADD CONSTRAINT "portal_fields_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "portal_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "portal_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_submissions" ADD CONSTRAINT "portal_submissions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_logs" ADD CONSTRAINT "click_logs_shortLinkId_fkey" FOREIGN KEY ("shortLinkId") REFERENCES "short_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
