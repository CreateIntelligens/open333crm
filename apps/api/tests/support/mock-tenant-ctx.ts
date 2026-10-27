/**
 * service 單元測試用的 TenantCtx（change tenant-transaction-context）。
 *
 * tx 用呼叫端給的 mock，只需實作 service 會呼叫的 model 方法。
 * notify、notifyAgent、publish、enqueue、afterCommit 只依呼叫順序記錄，不送出也不執行；
 * 「commit 之後才送出」由 inTenant() 自己的測試負責。
 */
import type { JobsOptions } from 'bullmq';
import type { TenantCtx } from '#src/lib/tenant-ctx.js';
import type { AppEventName } from '#src/events/event-bus.js';
import { agentPushRoom, tenantPushRoom } from '#src/events/socket-push.js';

export const MOCK_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

export interface MockTenantCtx {
  ctx: TenantCtx;
  /** room 是系統決定的房間，與 inTenant() 相同 */
  pushed: Array<{ room: string; name: string; data: unknown }>;
  published: Array<{ name: AppEventName; payload: Record<string, unknown> }>;
  enqueued: Array<{ queueName: string; name: string; data: unknown; opts?: JobsOptions }>;
  /** 測試要模擬 commit 時，自己依序呼叫 fn */
  afterCommitted: Array<{ label: string; fn: () => void | Promise<void> }>;
}

export function createMockTenantCtx(tx: unknown, tenantId: string = MOCK_TENANT_ID): MockTenantCtx {
  const pushed: MockTenantCtx['pushed'] = [];
  const published: MockTenantCtx['published'] = [];
  const enqueued: MockTenantCtx['enqueued'] = [];
  const afterCommitted: MockTenantCtx['afterCommitted'] = [];
  const ctx: TenantCtx = {
    tx: tx as TenantCtx['tx'],
    tenantId,
    notify(name, data) {
      pushed.push({ room: tenantPushRoom(tenantId), name, data });
    },
    notifyAgent(agentId, name, data) {
      pushed.push({ room: agentPushRoom(tenantId, agentId), name, data });
    },
    async publish(name, payload) {
      published.push({ name, payload });
    },
    async enqueue(queueName, name, data, opts) {
      enqueued.push({ queueName, name, data, opts });
    },
    afterCommit(label, fn) {
      afterCommitted.push({ label, fn });
    },
  };
  return { ctx, pushed, published, enqueued, afterCommitted };
}
