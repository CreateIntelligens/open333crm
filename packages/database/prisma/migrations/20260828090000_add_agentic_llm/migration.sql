-- Agent runs, bounded tool traces, and temporary report drafts.
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "conversationId" UUID,
    "initiatedById" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "finalText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stopReason" TEXT,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_tool_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "turn" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_report_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "markdown" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shareUrl" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_report_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_report_drafts_runId_key" ON "agent_report_drafts"("runId");
CREATE INDEX "agent_runs_tenantId_createdAt_idx" ON "agent_runs"("tenantId", "createdAt");
CREATE INDEX "agent_runs_tenantId_expiresAt_idx" ON "agent_runs"("tenantId", "expiresAt");
CREATE INDEX "agent_runs_tenantId_status_idx" ON "agent_runs"("tenantId", "status");
CREATE INDEX "agent_tool_calls_tenantId_runId_turn_idx" ON "agent_tool_calls"("tenantId", "runId", "turn");
CREATE INDEX "agent_tool_calls_tenantId_expiresAt_idx" ON "agent_tool_calls"("tenantId", "expiresAt");
CREATE INDEX "agent_report_drafts_tenantId_expiresAt_idx" ON "agent_report_drafts"("tenantId", "expiresAt");
CREATE INDEX "agent_report_drafts_tenantId_status_idx" ON "agent_report_drafts"("tenantId", "status");

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_report_drafts" ADD CONSTRAINT "agent_report_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_report_drafts" ADD CONSTRAINT "agent_report_drafts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
