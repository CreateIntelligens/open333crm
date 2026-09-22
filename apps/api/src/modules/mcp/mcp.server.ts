import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server as SocketIOServer } from "socket.io";
import type { TenantDb } from "../../lib/tenant-db.js";
import { z } from "zod";

import { getAgentById } from "../auth/auth.service.js";
import { getContact, listContacts } from "../contact/contact.service.js";
import { getConversation, listConversations } from "../conversation/conversation.service.js";
import {
  getCaseStats,
  getOverviewStats,
} from "../analytics/analytics.service.js";
import { listCases, getCase } from "../case/case.service.js";
import { createBroadcast, executeBroadcast, getBroadcast } from "../marketing/marketing.service.js";
import { decryptCredentials } from "../channel/channel.service.js";
import { getChannelPlugin } from "@open333crm/channel-plugins";
import { sendMessage as sendConversationMessage } from "../conversation/conversation.service.js";
import { writeLineMcpAudit } from "./line-mcp-audit.js";
import { createLineMcpConfirmation, verifyLineMcpConfirmation } from "./line-mcp-confirmation.js";
import { lineMcpDirectSendSchema } from "./line-mcp.schemas.js";
import { lineMcpBroadcastInitiateSchema } from "./line-mcp.schemas.js";
import {
  MCP_LINE_BROADCAST_SCOPE,
  MCP_LINE_SEND_SCOPE,
  MCP_LINE_READ_SCOPE,
} from "./mcp.constants.js";

export interface McpAgentContext {
  id: string;
  tenantId: string;
  role: string;
  scopes: string[];
  cliSessionId: string;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) =>
    typeof nestedValue === "bigint" ? String(nestedValue) : nestedValue,
  );
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: serialize(value) }],
  };
}

function scopeError(scope: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ code: "INSUFFICIENT_SCOPE", scope }) }],
  };
}

function operationError(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }],
  };
}

function hasScope(agent: McpAgentContext, scope: string): boolean {
  return agent.scopes.includes(scope);
}

function dateRange(input: { from?: string; to?: string }) {
  const from = input.from
    ? new Date(input.from)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = input.to ? new Date(input.to) : new Date();

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("from and to must be valid ISO timestamps");
  }
  if (from > to) {
    throw new Error("from must be earlier than or equal to to");
  }

  return { from, to };
}

export function createMcpServer(
  prisma: TenantDb,
  agent: McpAgentContext,
  _io?: SocketIOServer,
): McpServer {
  const server = new McpServer({
    name: "open333crm",
    version: "0.4.0",
  });

  server.registerTool(
    "crm_get_current_agent",
    {
      title: "Get current CRM agent",
      description:
        "Return the authenticated CRM agent identity and tenant-scoped team membership.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      textResult(await getAgentById(prisma, agent.id, agent.tenantId)),
  );

  server.registerTool(
    "crm_search_contacts",
    {
      title: "Search CRM contacts",
      description:
        "Search tenant-scoped CRM contacts by name, phone, or email.",
      inputSchema: {
        q: z
          .string()
          .trim()
          .max(120)
          .optional()
          .describe("Search text for name, phone, or email"),
        page: z.number().int().min(1).max(1000).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ q, page, limit }) =>
      textResult(
        await listContacts(prisma, agent.tenantId, { q }, { page, limit }),
      ),
  );

  server.registerTool(
    "crm_list_cases",
    {
      title: "List CRM cases",
      description:
        "List tenant-scoped CRM cases with optional status, priority, assignee, and SLA filters.",
      inputSchema: {
        status: z.string().max(40).optional(),
        priority: z.string().max(40).optional(),
        assigneeId: z.string().uuid().optional(),
        category: z.string().max(120).optional(),
        slaStatus: z.enum(["normal", "warning", "breached"]).optional(),
        page: z.number().int().min(1).max(1000).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({
      status,
      priority,
      assigneeId,
      category,
      slaStatus,
      page,
      limit,
    }) =>
      textResult(
        await listCases(
          prisma,
          agent.tenantId,
          { status, priority, assigneeId, category, slaStatus },
          { page, limit },
        ),
      ),
  );

  server.registerTool(
    "crm_get_case",
    {
      title: "Get CRM case",
      description:
        "Return one tenant-scoped CRM case with contact, assignee, team, and tags.",
      inputSchema: {
        id: z.string().uuid().describe("CRM case ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => textResult(await getCase(prisma, id, agent.tenantId)),
  );

  server.registerTool(
    "crm_get_contact",
    {
      title: "Get CRM contact",
      description:
        "Return one tenant-scoped CRM contact with channel identities and tags.",
      inputSchema: {
        id: z.string().uuid().describe("CRM contact ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => textResult(await getContact(prisma, id, agent.tenantId)),
  );

  server.registerTool(
    "crm_get_analytics_overview",
    {
      title: "Get CRM analytics overview",
      description:
        "Return tenant-scoped message, case, SLA, and CSAT metrics for a date range.",
      inputSchema: {
        from: z
          .string()
          .datetime()
          .optional()
          .describe("Inclusive ISO timestamp; defaults to 30 days ago"),
        to: z
          .string()
          .datetime()
          .optional()
          .describe("Inclusive ISO timestamp; defaults to now"),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { from, to } = dateRange(input);
      return textResult(
        await getOverviewStats(prisma, agent.tenantId, from, to),
      );
    },
  );

  server.registerTool(
    "crm_get_case_statistics",
    {
      title: "Get CRM case statistics",
      description:
        "Return tenant-scoped case trends and distributions for a date range.",
      inputSchema: {
        from: z
          .string()
          .datetime()
          .optional()
          .describe("Inclusive ISO timestamp; defaults to 30 days ago"),
        to: z
          .string()
          .datetime()
          .optional()
          .describe("Inclusive ISO timestamp; defaults to now"),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const { from, to } = dateRange(input);
      return textResult(await getCaseStats(prisma, agent.tenantId, from, to));
    },
  );

  server.registerTool(
    "crm_line_list_conversations",
    {
      title: "List LINE conversations",
      description: "List tenant-scoped LINE conversations with pagination and operational filters.",
      inputSchema: {
        page: z.number().int().min(1).max(1000).default(1),
        limit: z.number().int().min(1).max(50).default(20),
        status: z.string().max(40).optional(),
        channelType: z.string().max(40).default("LINE"),
        assigneeId: z.string().optional(),
        unread: z.boolean().optional(),
        closedAfter: z.string().datetime().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ page, limit, status, channelType, assigneeId, unread, closedAfter }) => {
      if (!hasScope(agent, MCP_LINE_READ_SCOPE)) return scopeError(MCP_LINE_READ_SCOPE);
      return textResult(await listConversations(
        prisma,
        agent.tenantId,
        { status, channelType, assigneeId, unread, closedAfter },
        { page, limit },
      ));
    },
  );

  server.registerTool(
    "crm_line_get_conversation",
    {
      title: "Get LINE conversation",
      description: "Get one tenant-scoped LINE conversation with contact, channel, tags, and case context.",
      inputSchema: { id: z.string().uuid().describe("Conversation ID") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      if (!hasScope(agent, MCP_LINE_READ_SCOPE)) return scopeError(MCP_LINE_READ_SCOPE);
      return textResult(await getConversation(prisma, id, agent.tenantId));
    },
  );

  server.registerTool(
    "crm_line_search_contacts",
    {
      title: "Search LINE contacts",
      description: "Search tenant-scoped contacts that have LINE identities.",
      inputSchema: {
        q: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).max(1000).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ q, page, limit }) => {
      if (!hasScope(agent, MCP_LINE_READ_SCOPE)) return scopeError(MCP_LINE_READ_SCOPE);
      return textResult(await listContacts(
        prisma,
        agent.tenantId,
        { q, channelType: "LINE" },
        { page, limit },
      ));
    },
  );

  server.registerTool(
    "crm_line_get_broadcast",
    {
      title: "Get LINE broadcast status",
      description: "Get tenant-scoped LINE broadcast status and recipient reply metrics.",
      inputSchema: { id: z.string().uuid().describe("Broadcast ID") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      if (!hasScope(agent, MCP_LINE_READ_SCOPE)) return scopeError(MCP_LINE_READ_SCOPE);
      return textResult(await getBroadcast(prisma, id, agent.tenantId));
    },
  );

  server.registerTool(
    "crm_line_direct_send",
    {
      title: "Send a confirmed LINE message",
      description: "Preview and then explicitly confirm one tenant-scoped LINE conversation message.",
      inputSchema: {
        conversationId: z.string().uuid().optional(),
        channelId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        contentType: z.string().max(80).optional(),
        content: z.record(z.unknown()).optional(),
        confirmationToken: z.string().min(1).max(4096).optional(),
        confirmation: z.literal(true).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (rawInput) => {
      if (!hasScope(agent, MCP_LINE_SEND_SCOPE)) return scopeError(MCP_LINE_SEND_SCOPE);
      const input = lineMcpDirectSendSchema.parse(rawInput);

      if (input.confirmationToken) {
        if (input.confirmation !== true) {
          return operationError("CONFIRMATION_REQUIRED", "confirmation=true is required for phase 2");
        }
        let claims;
        try {
          claims = verifyLineMcpConfirmation(input.confirmationToken, {
            op: "direct_send",
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
          });
        } catch {
          return operationError("INVALID_CONFIRMATION", "The confirmation token is invalid or expired");
        }

        await writeLineMcpAudit(prisma, {
          tenantId: agent.tenantId,
          agentId: agent.id,
          cliSessionId: agent.cliSessionId,
          operation: "direct_send",
          outcome: "confirmed",
          conversationId: claims.conversationId,
        });

        if (!_io) return operationError("SOCKET_UNAVAILABLE", "MCP direct send requires the API Socket.IO instance");
        try {
          const result = await sendConversationMessage(
            prisma,
            _io,
            claims.conversationId!,
            agent.id,
            agent.tenantId,
            { contentType: claims.contentType!, content: claims.content ?? {} },
          );
          await writeLineMcpAudit(prisma, {
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
            operation: "direct_send",
            outcome: result.delivery?.success ? "dispatched" : "failed",
            conversationId: claims.conversationId,
          }, { messageId: result.message.id, requestId: result.delivery?.requestId });
          return textResult({
            status: result.delivery?.success ? "dispatched" : "failed",
            messageId: result.message.id,
            delivery: result.delivery,
          });
        } catch (error) {
          await writeLineMcpAudit(prisma, {
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
            operation: "direct_send",
            outcome: "failed",
            conversationId: claims.conversationId,
            errorCode: error instanceof Error ? error.name : "UNKNOWN",
          });
          return operationError("LINE_SEND_FAILED", error instanceof Error ? error.message : String(error));
        }
      }

      if ((!input.conversationId && (!input.channelId || !input.contactId)) || !input.contentType || !input.content) {
        return operationError("PREVIEW_INPUT_REQUIRED", "conversationId or channelId/contactId, plus contentType and content, are required for phase 1");
      }
      let conversationId = input.conversationId;
      if (!conversationId) {
        const candidate = await prisma.conversation.findFirst({
          where: {
            tenantId: agent.tenantId,
            channelId: input.channelId,
            contactId: input.contactId,
            channelType: "LINE",
          },
          select: { id: true },
        });
        conversationId = candidate?.id;
      }
      if (!conversationId) return operationError("CONVERSATION_NOT_FOUND", "No tenant-scoped LINE conversation matches the target");
      const conversation = await getConversation(prisma, conversationId, agent.tenantId);
      if (conversation.channel.channelType !== "LINE") {
        return operationError("LINE_CHANNEL_REQUIRED", "The conversation must belong to a LINE channel");
      }
      const confirmationToken = createLineMcpConfirmation({
        op: "direct_send",
        tenantId: agent.tenantId,
        agentId: agent.id,
        cliSessionId: agent.cliSessionId,
        conversationId,
        contentType: input.contentType,
        content: input.content,
      });
      await writeLineMcpAudit(prisma, {
        tenantId: agent.tenantId,
        agentId: agent.id,
        cliSessionId: agent.cliSessionId,
        operation: "direct_send",
        outcome: "previewed",
        channelId: conversation.channel.id,
        conversationId,
        contactId: conversation.contact.id,
      });
      return textResult({
        status: "preview",
        confirmationToken,
        expiresInSeconds: 300,
        audience: {
          conversationId: input.conversationId,
          contactId: conversation.contact.id,
          displayName: conversation.contact.displayName,
          channelId: conversation.channel.id,
        },
        message: { contentType: input.contentType, content: input.content },
      });
    },
  );

  server.registerTool(
    "crm_line_broadcast_initiate",
    {
      title: "Initiate a confirmed LINE broadcast",
      description: "Preview and then explicitly confirm a tenant-scoped LINE broadcast workflow.",
      inputSchema: {
        broadcastId: z.string().uuid().optional(),
        name: z.string().min(1).max(200).optional(),
        materialId: z.string().uuid().optional(),
        templateId: z.string().uuid().optional(),
        channelId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        segmentId: z.string().uuid().optional(),
        targetType: z.enum(["all", "segment", "tags", "contacts"]).optional(),
        targetConfig: z.object({
          tagIds: z.array(z.string().uuid()).optional(),
          contactIds: z.array(z.string().uuid()).optional(),
        }).optional(),
        scheduledAt: z.string().optional(),
        confirmationToken: z.string().min(1).max(4096).optional(),
        confirmation: z.literal(true).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (rawInput) => {
      if (!hasScope(agent, MCP_LINE_BROADCAST_SCOPE)) return scopeError(MCP_LINE_BROADCAST_SCOPE);
      const input = lineMcpBroadcastInitiateSchema.parse(rawInput);

      if (input.confirmationToken) {
        if (input.confirmation !== true) {
          return operationError("CONFIRMATION_REQUIRED", "confirmation=true is required for phase 2");
        }
        let claims;
        try {
          claims = verifyLineMcpConfirmation(input.confirmationToken, {
            op: "broadcast",
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
          });
        } catch {
          return operationError("INVALID_CONFIRMATION", "The confirmation token is invalid or expired");
        }
        const broadcastId = claims.broadcastId!;
        const broadcast = await getBroadcast(prisma, broadcastId, agent.tenantId);
        const channel = await prisma.channel.findFirst({
          where: { id: broadcast.channelId, tenantId: agent.tenantId, isActive: true },
          select: { id: true, channelType: true, credentialsEncrypted: true },
        });
        if (!channel || channel.channelType !== "LINE") {
          return operationError("LINE_CHANNEL_REQUIRED", "The broadcast must target an active LINE channel");
        }

        const plugin = getChannelPlugin(channel.channelType);
        let quota: { totalUsage: number; maxMessages?: number } | null = null;
        if (plugin?.extensions?.analytics?.getMessageQuota) {
          const credentials = decryptCredentials(channel.credentialsEncrypted);
          quota = await plugin.extensions.analytics.getMessageQuota(credentials);
        }
        const requiredMessages = Math.max(1, broadcast.totalCount);
        if (quota?.maxMessages !== undefined && quota.totalUsage + requiredMessages > quota.maxMessages) {
          await writeLineMcpAudit(prisma, {
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
            operation: "broadcast",
            outcome: "rejected",
            channelId: broadcast.channelId,
            broadcastId,
            errorCode: "QUOTA_EXCEEDED",
          }, { quota });
          return operationError("QUOTA_EXCEEDED", "LINE monthly message quota would be exceeded");
        }
        if (!_io) return operationError("SOCKET_UNAVAILABLE", "MCP broadcast requires the API Socket.IO instance");

        await writeLineMcpAudit(prisma, {
          tenantId: agent.tenantId,
          agentId: agent.id,
          cliSessionId: agent.cliSessionId,
          operation: "broadcast",
          outcome: "confirmed",
          channelId: broadcast.channelId,
          broadcastId,
        });
        try {
          const result = await executeBroadcast(prisma, _io, broadcastId);
          await writeLineMcpAudit(prisma, {
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
            operation: "broadcast",
            outcome: "dispatched",
            channelId: broadcast.channelId,
            broadcastId,
          }, { result });
          return textResult({ status: "dispatched", broadcastId, result });
        } catch (error) {
          await writeLineMcpAudit(prisma, {
            tenantId: agent.tenantId,
            agentId: agent.id,
            cliSessionId: agent.cliSessionId,
            operation: "broadcast",
            outcome: "failed",
            channelId: broadcast.channelId,
            broadcastId,
            errorCode: error instanceof Error ? error.name : "UNKNOWN",
          });
          return operationError("BROADCAST_FAILED", error instanceof Error ? error.message : String(error));
        }
      }

      let broadcast;
      if (input.broadcastId) {
        broadcast = await getBroadcast(prisma, input.broadcastId, agent.tenantId);
      } else {
        if (!input.name || !input.materialId && !input.templateId || !input.channelId || !input.targetType) {
          return operationError("PREVIEW_INPUT_REQUIRED", "broadcastId or broadcast creation fields are required for phase 1");
        }
        broadcast = await createBroadcast(prisma, agent.tenantId, agent.id, {
          name: input.name,
          materialId: input.materialId,
          templateId: input.templateId,
          channelId: input.channelId,
          campaignId: input.campaignId,
          segmentId: input.segmentId,
          targetType: input.targetType,
          targetConfig: input.targetConfig,
          scheduledAt: input.scheduledAt,
        });
      }
      const channel = await prisma.channel.findFirst({
        where: { id: broadcast.channelId, tenantId: agent.tenantId, isActive: true },
        select: { id: true, channelType: true, credentialsEncrypted: true },
      });
      if (!channel || channel.channelType !== "LINE") {
        return operationError("LINE_CHANNEL_REQUIRED", "The broadcast must target an active LINE channel");
      }
      const plugin = getChannelPlugin(channel.channelType);
      let quota: { totalUsage: number; maxMessages?: number } | null = null;
      if (plugin?.extensions?.analytics?.getMessageQuota) {
        quota = await plugin.extensions.analytics.getMessageQuota(decryptCredentials(channel.credentialsEncrypted));
      }
      const confirmationToken = createLineMcpConfirmation({
        op: "broadcast",
        tenantId: agent.tenantId,
        agentId: agent.id,
        cliSessionId: agent.cliSessionId,
        broadcastId: broadcast.id,
      });
      await writeLineMcpAudit(prisma, {
        tenantId: agent.tenantId,
        agentId: agent.id,
        cliSessionId: agent.cliSessionId,
        operation: "broadcast",
        outcome: "previewed",
        channelId: broadcast.channelId,
        broadcastId: broadcast.id,
      }, { quota, targetType: broadcast.targetType, totalCount: broadcast.totalCount });
      return textResult({
        status: "preview",
        confirmationToken,
        expiresInSeconds: 300,
        broadcastId: broadcast.id,
        targetType: broadcast.targetType,
        totalCount: broadcast.totalCount,
        quota,
      });
    },
  );

  return server;
}
