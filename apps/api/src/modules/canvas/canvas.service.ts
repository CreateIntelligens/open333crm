/**
 * Canvas management service — CRUD + analytics (Tasks 5.1, 5.4)
 */

import type { PrismaClient } from '@prisma/client';
// FlowRunner is imported from the barrel after `pnpm build` of @open333crm/core
import { FlowRunner } from '@open333crm/core';

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listFlows(
  prisma: PrismaClient,
  tenantId: string,
  opts: { page: number; limit: number; status?: string },
) {
  const { page, limit, status } = opts;
  const skip = (page - 1) * limit;

  const [total, flows] = await Promise.all([
    prisma.interactionFlow.count({ where: { tenantId, ...(status ? { status: status as never } : {}) } }),
    prisma.interactionFlow.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { _count: { select: { nodes: true, executions: true } } },
    }),
  ]);

  return { flows, total };
}

export async function getFlow(prisma: PrismaClient, id: string, tenantId: string) {
  const flow = await prisma.interactionFlow.findFirstOrThrow({
    where: { id, tenantId },
    include: { nodes: { orderBy: { sortOrder: 'asc' } } },
  });
  return flow;
}

export async function createFlow(
  prisma: PrismaClient,
  tenantId: string,
  data: {
    name: string;
    description?: string;
    triggerType: string;
    triggerConfig?: object;
    maxStepLimit?: number;
    nodes?: Array<{
      nodeType: string;
      label: string;
      config?: object;
      position?: object;
      nextNodeId?: string;
      falseNodeId?: string;
      sortOrder?: number;
    }>;
  },
) {
  const { nodes, ...flowData } = data;

  return prisma.interactionFlow.create({
    data: {
      tenantId,
      ...flowData,
      triggerConfig: flowData.triggerConfig ?? {},
      nodes: nodes
        ? {
            create: nodes.map((n, i) => ({
              nodeType: n.nodeType as never,
              label: n.label,
              config: n.config ?? {},
              position: n.position ?? {},
              nextNodeId: n.nextNodeId,
              falseNodeId: n.falseNodeId,
              sortOrder: n.sortOrder ?? i,
            })),
          }
        : undefined,
    },
    include: { nodes: true },
  });
}

export async function updateFlow(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    name?: string;
    description?: string;
    triggerType?: string;
    triggerConfig?: object;
    maxStepLimit?: number;
    status?: string;
  },
) {
  return prisma.interactionFlow.update({
    where: { id, tenantId },
    data,
    include: { nodes: true },
  });
}

export async function activateFlow(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  return prisma.interactionFlow.update({
    where: { id, tenantId },
    data: { status: 'ACTIVE' },
  });
}

// ── Analytics (Task 5.4) ───────────────────────────────────────────────────

export interface NodeAnalytics {
  nodeId: string;
  label: string;
  nodeType: string;
  entryCount: number;
  exitCount: number;
  dropOffRate: number; // 0–1
}

/**
 * Calculate per-node entry, exit, and drop-off rates for a flow.
 */
export async function getFlowAnalytics(
  prisma: PrismaClient,
  flowId: string,
  tenantId: string,
): Promise<{ nodes: NodeAnalytics[]; totalExecutions: number; completionRate: number }> {
  const flow = await prisma.interactionFlow.findFirstOrThrow({
    where: { id: flowId, tenantId },
    include: { nodes: true },
  });

  // Aggregate node entry counts from FlowLog
  const entryCounts = await prisma.flowLog.groupBy({
    by: ['nodeId'],
    where: {
      execution: { flowId, tenantId },
      action: 'node_entered',
      nodeId: { not: null },
    },
    _count: { _all: true },
  });

  const countMap = new Map(
    entryCounts.map((c) => [c.nodeId!, c._count._all]),
  );

  // Total executions
  const totalExecutions = await prisma.flowExecution.count({ where: { flowId, tenantId } });
  const completed = await prisma.flowExecution.count({
    where: { flowId, tenantId, status: 'COMPLETED' },
  });

  const completionRate = totalExecutions > 0 ? completed / totalExecutions : 0;

  // Build per-node analytics
  const nodeAnalytics: NodeAnalytics[] = (flow.nodes as Array<{ id: string; label: string; nodeType: string; nextNodeId: string | null }>).map((node) => {
    const entryCount = countMap.get(node.id) ?? 0;
    const nextEntryCount = node.nextNodeId ? (countMap.get(node.nextNodeId) ?? 0) : entryCount;
    const dropOffRate = entryCount > 0 ? Math.max(0, (entryCount - nextEntryCount) / entryCount) : 0;

    return {
      nodeId: node.id,
      label: node.label,
      nodeType: node.nodeType,
      entryCount,
      exitCount: nextEntryCount,
      dropOffRate: Math.round(dropOffRate * 1000) / 1000,
    };
  });

  return { nodes: nodeAnalytics, totalExecutions, completionRate };
}

// ── Execution management ───────────────────────────────────────────────────

export async function listExecutions(
  prisma: PrismaClient,
  flowId: string,
  tenantId: string,
  opts: { page: number; limit: number; status?: string },
) {
  const { page, limit, status } = opts;
  const skip = (page - 1) * limit;

  const [total, executions] = await Promise.all([
    prisma.flowExecution.count({ where: { flowId, tenantId, ...(status ? { status: status as never } : {}) } }),
    prisma.flowExecution.findMany({
      where: { flowId, tenantId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return { executions, total };
}

/**
 * Manually trigger a flow for a specific contact (for testing / manual invocation).
 */
export async function triggerFlow(
  prisma: PrismaClient,
  flowId: string,
  contactId: string,
  tenantId: string,
  vars: object = {},
): Promise<string> {
  const execution = await prisma.flowExecution.create({
    data: {
      flowId,
      contactId,
      tenantId,
      status: 'RUNNING',
      contextVars: vars,
    },
  });

  // Run async (non-blocking)
  FlowRunner.run(execution.id).catch(() => {});

  return execution.id;
}
