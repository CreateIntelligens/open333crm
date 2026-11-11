/**
 * Canvas management service — CRUD + analytics (Tasks 5.1, 5.4)
 *
 * 每個函式收 TenantCtx（#337 階段 4，AGENTS.md 結構規則 2）。手動觸發只建立 execution，
 * 由 flow 在 commit 之後交給流程引擎（canvas-effects.ts）。
 */

import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { notFound } from '../../shared/messages/resource.js';
import { AppError } from '../../shared/utils/response.js';

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listFlows(
  ctx: TenantCtx,
  opts: { page: number; limit: number; status?: string },
) {
  const { page, limit, status } = opts;
  const skip = (page - 1) * limit;
  const where = { tenantId: ctx.tenantId, ...(status ? { status: status as never } : {}) };

  const [total, flows] = await Promise.all([
    ctx.tx.interactionFlow.count({ where }),
    ctx.tx.interactionFlow.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { _count: { select: { nodes: true, executions: true } } },
    }),
  ]);

  return { flows, total };
}

export async function getFlow(ctx: TenantCtx, id: string) {
  const flow = await ctx.tx.interactionFlow.findFirstOrThrow({
    where: { id, tenantId: ctx.tenantId },
    include: { nodes: { orderBy: { sortOrder: 'asc' } } },
  });
  return flow;
}

export async function createFlow(
  ctx: TenantCtx,
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

  return ctx.tx.interactionFlow.create({
    data: {
      tenantId: ctx.tenantId,
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
  ctx: TenantCtx,
  id: string,
  data: {
    name?: string;
    description?: string;
    triggerType?: string;
    triggerConfig?: object;
    maxStepLimit?: number;
    status?: string;
  },
) {
  const updateData: {
    name?: string;
    description?: string;
    triggerType?: string;
    triggerConfig?: object;
    maxStepLimit?: number;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  } = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.triggerType !== undefined ? { triggerType: data.triggerType } : {}),
    ...(data.triggerConfig !== undefined ? { triggerConfig: data.triggerConfig } : {}),
    ...(data.maxStepLimit !== undefined ? { maxStepLimit: data.maxStepLimit } : {}),
    ...(data.status !== undefined ? { status: data.status as 'DRAFT' | 'ACTIVE' | 'ARCHIVED' } : {}),
  };

  // 找不到時 Prisma 丟 P2025，交易 rollback，錯誤處理器回 404
  return ctx.tx.interactionFlow.update({
    where: { id, tenantId: ctx.tenantId },
    data: updateData,
    include: { nodes: true },
  });
}

export async function activateFlow(ctx: TenantCtx, id: string) {
  return ctx.tx.interactionFlow.update({
    where: { id, tenantId: ctx.tenantId },
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
  ctx: TenantCtx,
  flowId: string,
): Promise<{ nodes: NodeAnalytics[]; totalExecutions: number; completionRate: number }> {
  const { tenantId } = ctx;
  const flow = await ctx.tx.interactionFlow.findFirstOrThrow({
    where: { id: flowId, tenantId },
    include: { nodes: true },
  });

  // Aggregate node entry counts from FlowLog
  const entryCounts = await ctx.tx.flowLog.groupBy({
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
  const totalExecutions = await ctx.tx.flowExecution.count({ where: { flowId, tenantId } });
  const completed = await ctx.tx.flowExecution.count({
    where: { flowId, tenantId, status: 'COMPLETED' },
  });

  const completionRate = totalExecutions > 0 ? completed / totalExecutions : 0;

  // Build per-node analytics
  const nodeAnalytics: NodeAnalytics[] = flow.nodes.map((node) => {
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

/** 流程不存在或屬於另一個租戶時回 404，與 getFlow 一致（spec interaction-canvas） */
export async function listExecutions(
  ctx: TenantCtx,
  flowId: string,
  opts: { page: number; limit: number; status?: string },
) {
  const { tenantId } = ctx;
  const flow = await ctx.tx.interactionFlow.findFirst({ where: { id: flowId, tenantId }, select: { id: true } });
  if (!flow) throw new AppError(notFound('flow'), 'NOT_FOUND', 404);

  const { page, limit, status } = opts;
  const skip = (page - 1) * limit;
  const where = { flowId, tenantId, ...(status ? { status: status as never } : {}) };

  const [total, executions] = await Promise.all([
    ctx.tx.flowExecution.count({ where }),
    ctx.tx.flowExecution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return { executions, total };
}

/**
 * 手動觸發前的檢查：流程屬於本租戶而且是 ACTIVE，聯絡人屬於本租戶。
 * 外鍵檢查不套用 RLS，flow_executions.contactId 也沒有外鍵，所以不能只靠寫入時的約束。
 */
export async function assertFlowTriggerable(ctx: TenantCtx, flowId: string, contactId: string) {
  const { tenantId } = ctx;
  const flow = await ctx.tx.interactionFlow.findFirst({ where: { id: flowId, tenantId }, select: { status: true } });
  if (!flow) throw new AppError(notFound('flow'), 'NOT_FOUND', 404);
  if (flow.status !== 'ACTIVE') {
    throw new AppError('流程尚未啟用，請先啟用再觸發', 'FLOW_NOT_ACTIVE', 409);
  }
  const contact = await ctx.tx.contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true } });
  if (!contact) throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
}

/** 建立一筆 RUNNING 的 execution。手動觸發與收訊的自動觸發共用（design D6） */
export async function createFlowExecution(
  ctx: TenantCtx,
  input: { flowId: string; contactId: string; vars?: object },
): Promise<string> {
  const execution = await ctx.tx.flowExecution.create({
    data: {
      flowId: input.flowId,
      contactId: input.contactId,
      tenantId: ctx.tenantId,
      status: 'RUNNING',
      contextVars: input.vars ?? {},
    },
    select: { id: true },
  });
  return execution.id;
}

/**
 * Manually trigger a flow for a specific contact (for testing / manual invocation).
 * 只寫入 execution；流程引擎由 flow 在 commit 之後開始執行。
 */
export async function triggerFlow(
  ctx: TenantCtx,
  input: { flowId: string; contactId: string; vars?: object },
): Promise<string> {
  await assertFlowTriggerable(ctx, input.flowId, input.contactId);
  return createFlowExecution(ctx, input);
}
