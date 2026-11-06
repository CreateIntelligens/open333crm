/**
 * canvas 的 flow（#337 階段 4，AGENTS.md 結構規則 2）：流程管理與手動觸發。
 *
 * - 手動觸發在交易內檢查流程與聯絡人、建立 execution；流程引擎在 commit 之後才開始執行。
 * - 收訊的自動觸發（canvas.webhook.ts）與引擎還沒搬遷，仍用 singleton（AUDIT RLS-01）。
 */
import type { PrismaClient } from '@prisma/client';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import { startFlowAfterCommit, type RunFlow } from './canvas-effects.js';
import {
  activateFlow,
  createFlow,
  getFlow,
  getFlowAnalytics,
  listExecutions,
  listFlows,
  triggerFlow,
  updateFlow,
} from './canvas.service.js';

export interface CanvasFlowDeps {
  prisma: PrismaClient;
  runFlow: RunFlow;
}

export const listFlowsFlow = flowOf(listFlows);
export const getFlowFlow = flowOf(getFlow);
export const createFlowFlow = flowOf(createFlow);
export const updateFlowFlow = flowOf(updateFlow);
export const activateFlowFlow = flowOf(activateFlow);
export const getFlowAnalyticsFlow = flowOf(getFlowAnalytics);
export const listExecutionsFlow = flowOf(listExecutions);

export function triggerFlowFlow(
  deps: CanvasFlowDeps,
  tenantId: string,
  input: { flowId: string; contactId: string; vars?: object },
) {
  return inTenant(deps.prisma, tenantId, async (scope) => {
    const executionId = await triggerFlow(scope, input);
    startFlowAfterCommit(scope, deps.runFlow, executionId);
    return executionId;
  });
}
