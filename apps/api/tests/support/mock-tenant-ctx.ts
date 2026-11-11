/**
 * 單元測試用的 TenantCtx 與 TenantScope（change tenant-transaction-context、migrate-role-agent-tenant-ctx）。
 *
 * tx 用呼叫端給的 mock，只需實作被測程式會呼叫的 model 方法。
 * - createMockTenantCtx：給 service，只有 tx 與 tenantId。
 * - createMockTenantScope：給 flow，afterCommit 只依呼叫順序記錄；測試要模擬 commit 時呼叫 commit()。
 *   推播、事件、job 都經由 afterCommit 登記，所以 commit() 之後才會記到假的 io 或 publisher。
 * 「commit 之後才執行」由 inTenant() 自己的測試負責。
 */
import type { TenantCtx, TenantScope } from '#src/lib/tenant-ctx.js';

export const MOCK_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

export function createMockTenantCtx(tx: unknown, tenantId: string = MOCK_TENANT_ID): { ctx: TenantCtx } {
  return { ctx: { tx: tx as TenantCtx['tx'], tenantId } };
}

export interface MockTenantScope {
  scope: TenantScope;
  afterCommitted: Array<{ label: string; fn: () => unknown }>;
  /** 依登記順序執行 afterCommit 的動作，與 inTenant() 相同 */
  commit(): Promise<void>;
}

export function createMockTenantScope(tx: unknown, tenantId: string = MOCK_TENANT_ID): MockTenantScope {
  const afterCommitted: MockTenantScope['afterCommitted'] = [];
  return {
    scope: {
      tx: tx as TenantCtx['tx'],
      tenantId,
      afterCommit(label, fn) {
        afterCommitted.push({ label, fn });
      },
    },
    afterCommitted,
    async commit() {
      for (const { fn } of afterCommitted) await fn();
    },
  };
}
