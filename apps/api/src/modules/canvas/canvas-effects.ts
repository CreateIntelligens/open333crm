/**
 * canvas 的副作用（change migrate-canvas-tenant-ctx，design D2、D6）。手動觸發與收訊的自動觸發共用。
 */
import { logger } from '@open333crm/core';
import type { TenantScope } from '../../lib/tenant-ctx.js';

export type RunFlow = (executionId: string) => Promise<void>;

/**
 * commit 之後開始執行流程，最多一次；rollback 時不執行（spec interaction-canvas）。
 *
 * 不等流程執行完：afterCommit 等這個函式結束，flow 才 return，等完整個流程會讓回應跟著變慢。
 * commit 之後、開始執行之前處理程序結束時，execution 停在 RUNNING，沒有程式會再執行它。
 */
export function startFlowAfterCommit(scope: TenantScope, runFlow: RunFlow, executionId: string): void {
  scope.afterCommit('canvas.flow-run', () => {
    runFlow(executionId).catch((err: unknown) => {
      logger.error(`[Canvas] 流程執行失敗（execution ${executionId}）`, err);
    });
  });
}
