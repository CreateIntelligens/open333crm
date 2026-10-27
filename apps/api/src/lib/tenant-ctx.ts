/**
 * 租戶資料存取的交易邊界（主規格 tenant-transaction-context，issue #337）。
 *
 * 入口（flow、背景工作）以 inTenant() 開一個綁定租戶的交易；route 不開交易，一律呼叫 flow：
 * - 交易內的寫入一起成功或一起失敗，查詢都受 RLS 約束到 tenantId。
 * - 入口拿到 TenantScope：TenantCtx 加上 afterCommit。afterCommit 的動作在 commit 之後依登記順序執行，
 *   inTenant() 等它們完成才回傳；rollback 時不執行；失敗只記 log；最多一次。
 * - service 只收 TenantCtx（tx、tenantId），拿不到任何副作用的能力。
 *
 * 推播、事件、job、稽核是收 scope 的獨立函式，不是 scope 的方法（change migrate-role-agent-tenant-ctx，決策 6）：
 * notifyTenant / notifyAgent（events/socket-push.ts）、publishEvent / enqueueJob（events/outbox-publisher.ts）、
 * recordTenantAudit（modules/tenant-audit/tenant-audit.service.ts）。什麼時候用哪個，見 AGENTS.md 結構規則 2。
 *
 * service 不自己開交易，也不在交易內呼叫外部服務（LINE、LLM 等）。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@open333crm/core';
import { withTenant } from './tenant-db.js';

/** service 收的參數：已設定 app.current_tenant 的交易與綁定的租戶 */
export interface TenantCtx {
  /** 已設定 app.current_tenant 的交易；查詢都要用它 */
  readonly tx: Prisma.TransactionClient;
  readonly tenantId: string;
}

/** 入口（flow、背景工作）在 inTenant() 內拿到的 scope */
export interface TenantScope extends TenantCtx {
  /**
   * commit 之後執行 fn，inTenant() 等它完成才回傳；rollback 時不執行。
   * 失敗只記 log，不補做。推播、outbox 的快路徑與清快取都經由這裡登記
   */
  afterCommit(label: string, fn: () => unknown): void;
}

export async function inTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  const effects: Array<{ label: string; run: () => unknown }> = [];

  const result = await withTenant(prisma, tenantId, (tx) =>
    fn({
      tx,
      tenantId,
      afterCommit(label, run) {
        effects.push({ label, run });
      },
    }),
  );

  // 走到這裡代表已經 commit：資料已寫入，送出失敗不能讓結果變成失敗
  for (const effect of effects) {
    try {
      await effect.run();
    } catch (err) {
      logger.error(`[inTenant] commit 後的動作失敗（${effect.label}）`, err);
    }
  }
  return result;
}

/**
 * 只呼叫一個 service 函式的 flow：開交易、呼叫 fn、回傳結果，沒有其他步驟。
 * 例：`export const listStoresFlow = flowOf(listStores);`，route 呼叫 `listStoresFlow(app, tenantId)`。
 * 要加副作用（稽核、推播、快取）或交易外的工作時，改寫成一般的 flow 函式。
 */
export function flowOf<A extends unknown[], R>(fn: (ctx: TenantCtx, ...args: A) => Promise<R>) {
  return (deps: { prisma: PrismaClient }, tenantId: string, ...args: A): Promise<R> =>
    inTenant(deps.prisma, tenantId, (scope) => fn(scope, ...args));
}
