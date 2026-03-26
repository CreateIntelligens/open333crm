/**
 * Core FlowRunner — parses nodes and executes synchronous actions (Task 3.1)
 * Uses state-machine architecture: loads FlowExecution, processes nodes, updates state.
 */

import { prisma } from '@open333crm/database';
import { logger } from '../logger/index.js';
import { EventBus } from '../event-bus/event-bus.js';
import type { FlowContext, FlowNode } from './types.js';
import { executeApiFetchNode } from './api-fetch-node.js';
import { executeAiGenNode } from './ai-gen-node.js';
import { scheduleWaitNode } from './scheduler.js';
import { checkSmartWindow } from './smart-window.js';

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_STEP_LIMIT_DEFAULT = 100;

// ── FlowRunner ─────────────────────────────────────────────────────────────

export class FlowRunner {
  /**
   * Resume or start a FlowExecution by its ID.
   * Loads execution state from DB, traverses nodes until WAIT or terminal node.
   */
  static async run(executionId: string): Promise<void> {
    const execution = await prisma.flowExecution.findUniqueOrThrow({
      where: { id: executionId },
      include: { flow: { include: { nodes: true } } },
    });

    if (execution.status === 'COMPLETED' || execution.status === 'FAILED') {
      logger.warn(`[FlowRunner] Execution ${executionId} already ${execution.status}. Skipping.`);
      return;
    }

    const maxStepLimit = execution.flow.maxStepLimit ?? MAX_STEP_LIMIT_DEFAULT;
    let ctx: FlowContext = {
      contactId: execution.contactId,
      tenantId: execution.tenantId,
      flowId: execution.flowId,
      executionId,
      vars: (execution.contextVars as FlowContext['vars']) ?? {},
    };

    const nodeMap = new Map<string, FlowNode>(
      execution.flow.nodes.map((n) => [n.id, n as FlowNode]),
    );

    // Determine starting node
    let currentNodeId: string | null | undefined =
      execution.currentNodeId ?? findTriggerNode(execution.flow.nodes as FlowNode[]);

    let stepCount = execution.stepCount ?? 0;

    while (currentNodeId) {
      if (stepCount >= maxStepLimit) {
        await failExecution(executionId, 'Max step limit reached (infinite loop guard)');
        return;
      }

      const node = nodeMap.get(currentNodeId);
      if (!node) {
        await failExecution(executionId, `Node ${currentNodeId} not found in flow`);
        return;
      }

      stepCount++;

      await prisma.flowExecution.update({
        where: { id: executionId },
        data: { currentNodeId, stepCount, contextVars: ctx.vars as object },
      });

      // Log entry
      await logAction(executionId, node.id, 'node_entered', { nodeType: node.nodeType });

      try {
        const result = await executeNode(node, ctx, executionId);

        if (result.pause) {
          // WAIT node — execution suspended; scheduler will resume later
          await prisma.flowExecution.update({
            where: { id: executionId },
            data: {
              status: 'WAITING',
              resumeAt: result.resumeAt ?? null,
              contextVars: ctx.vars as object,
            },
          });
          return;
        }

        ctx = result.ctx;
        currentNodeId = result.nextNodeId ?? null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await failExecution(executionId, msg, node.id);
        return;
      }
    }

    // No more nodes → flow complete
    await prisma.flowExecution.update({
      where: { id: executionId },
      data: { status: 'COMPLETED', contextVars: ctx.vars as object, stepCount },
    });

    await EventBus.publish({
      type: 'flow.completed',
      tenantId: ctx.tenantId,
      payload: { executionId, contactId: ctx.contactId, flowId: ctx.flowId },
      timestamp: Date.now(),
    });

    logger.info(`[FlowRunner] Execution ${executionId} COMPLETED in ${stepCount} steps.`);
  }
}

// ── Node executor dispatch ─────────────────────────────────────────────────

interface NodeResult {
  ctx: FlowContext;
  nextNodeId?: string | null;
  pause?: boolean;
  resumeAt?: Date;
}

async function executeNode(
  node: FlowNode,
  ctx: FlowContext,
  executionId: string,
): Promise<NodeResult> {
  switch (node.nodeType) {
    case 'TRIGGER':
      // Trigger node is the entry point; just advance to next
      return { ctx, nextNodeId: node.nextNodeId };

    case 'MESSAGE': {
      const config = node.config as {
        channelType?: string;
        templateId?: string;
        text?: string;
      };
      // Dispatch via EventBus → channel plugin handles actual send
      await EventBus.publish({
        type: 'canvas.send_message',
        tenantId: ctx.tenantId,
        payload: {
          executionId,
          contactId: ctx.contactId,
          channelType: config.channelType,
          templateId: config.templateId,
          text: config.text,
          vars: ctx.vars,
        },
        timestamp: Date.now(),
      });
      await logAction(executionId, node.id, 'message_sent', config);
      return { ctx, nextNodeId: node.nextNodeId };
    }

    case 'CONDITION': {
      // Simple condition evaluation — checks ctx.vars against conditions
      const config = node.config as {
        field: string;
        operator: 'eq' | 'neq' | 'contains' | 'exists';
        value?: string;
      };
      const result = evaluateCondition(ctx, config);
      return { ctx, nextNodeId: result ? node.nextNodeId : node.falseNodeId };
    }

    case 'WAIT': {
      const config = node.config as {
        delayMs?: number;
        delayMinutes?: number;
        smartWindow?: boolean;
        timezone?: string;
      };
      const delayMs = config.delayMs ?? (config.delayMinutes ?? 0) * 60_000;
      let resumeAt = new Date(Date.now() + delayMs);

      if (config.smartWindow) {
        resumeAt = checkSmartWindow(resumeAt, config.timezone ?? 'Asia/Taipei');
      }

      await logAction(executionId, node.id, 'wait_scheduled', { resumeAt });
      await scheduleWaitNode(executionId, resumeAt);

      return { ctx, pause: true, resumeAt, nextNodeId: node.nextNodeId };
    }

    case 'API_FETCH': {
      const updatedCtx = await executeApiFetchNode(node.config as never, ctx);
      await logAction(executionId, node.id, 'api_fetched', { extKeys: Object.keys(updatedCtx.vars?.ext ?? {}) });
      return { ctx: updatedCtx, nextNodeId: node.nextNodeId };
    }

    case 'AI_GEN': {
      const updatedCtx = await executeAiGenNode(node.config as never, ctx);
      await logAction(executionId, node.id, 'ai_generated', { genKeys: Object.keys(updatedCtx.vars?.gen ?? {}) });
      return { ctx: updatedCtx, nextNodeId: node.nextNodeId };
    }

    case 'ACTION': {
      const config = node.config as {
        actionType: string;
        params: Record<string, unknown>;
      };
      await EventBus.publish({
        type: 'canvas.action',
        tenantId: ctx.tenantId,
        payload: {
          executionId,
          contactId: ctx.contactId,
          actionType: config.actionType,
          params: config.params,
        },
        timestamp: Date.now(),
      });
      await logAction(executionId, node.id, 'action_dispatched', config);
      return { ctx, nextNodeId: node.nextNodeId };
    }

    default:
      logger.warn(`[FlowRunner] Unknown nodeType: ${node.nodeType}`);
      return { ctx, nextNodeId: node.nextNodeId };
  }
}

// ── Helper utilities ───────────────────────────────────────────────────────

function findTriggerNode(nodes: FlowNode[]): string | undefined {
  return nodes.find((n) => n.nodeType === 'TRIGGER')?.id;
}

function evaluateCondition(
  ctx: FlowContext,
  config: { field: string; operator: string; value?: string },
): boolean {
  // Supports dot-notation for nested vars (e.g., 'ext.coupon_code')
  const fieldValue = config.field
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], ctx.vars);

  switch (config.operator) {
    case 'eq':      return String(fieldValue) === String(config.value ?? '');
    case 'neq':     return String(fieldValue) !== String(config.value ?? '');
    case 'contains': return String(fieldValue ?? '').includes(String(config.value ?? ''));
    case 'exists':  return fieldValue !== undefined && fieldValue !== null;
    default:        return false;
  }
}

async function logAction(
  executionId: string,
  nodeId: string | undefined,
  action: string,
  result: object,
): Promise<void> {
  await prisma.flowLog.create({
    data: {
      executionId,
      nodeId: nodeId ?? null,
      action,
      result,
    },
  });
}

async function failExecution(
  executionId: string,
  errorMessage: string,
  nodeId?: string,
): Promise<void> {
  logger.error(`[FlowRunner] Execution ${executionId} FAILED: ${errorMessage}`);
  await prisma.flowExecution.update({
    where: { id: executionId },
    data: { status: 'FAILED', errorMessage },
  });
  await logAction(executionId, nodeId, 'error', { errorMessage });
}
