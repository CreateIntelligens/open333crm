import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { getAgentById } from "../auth/auth.service.js";
import {
  getCaseStats,
  getOverviewStats,
} from "../analytics/analytics.service.js";
import { listCases, getCase } from "../case/case.service.js";
import { listContacts, getContact } from "../contact/contact.service.js";

export interface McpAgentContext {
  id: string;
  tenantId: string;
  role: string;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) =>
    typeof nestedValue === "bigint" ? Number(nestedValue) : nestedValue,
  );
}

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: serialize(value) }],
  };
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
  prisma: PrismaClient,
  agent: McpAgentContext,
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

  return server;
}
