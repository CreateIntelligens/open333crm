/**
 * service 單元測試用的 TenantCtx（change tenant-transaction-context）。
 *
 * tx 用呼叫端給的 mock，只需實作 service 會呼叫的 model 方法。
 * emit、publish 只依呼叫順序記錄，不送出；「commit 之後才送出」由 inTenant() 自己的測試負責。
 */
import type { TenantCtx } from '#src/lib/tenant-ctx.js';
import type { AppEventName } from '#src/events/event-bus.js';

export const MOCK_TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

export interface MockTenantCtx {
  ctx: TenantCtx;
  emitted: Array<{ room: string; event: string; data: unknown }>;
  published: Array<{ name: AppEventName; payload: Record<string, unknown> }>;
}

export function createMockTenantCtx(tx: unknown, tenantId: string = MOCK_TENANT_ID): MockTenantCtx {
  const emitted: MockTenantCtx['emitted'] = [];
  const published: MockTenantCtx['published'] = [];
  const ctx: TenantCtx = {
    tx: tx as TenantCtx['tx'],
    tenantId,
    emit(room, event, data) {
      // 與 inTenant() 相同：推到別的租戶房間是寫錯程式
      if (room.startsWith('tenant:') && room !== `tenant:${tenantId}`) {
        throw new Error(`createMockTenantCtx: 不能推播 ${event} 到別的租戶房間 ${room}`);
      }
      emitted.push({ room, event, data });
    },
    publish(name, payload) {
      published.push({ name, payload });
    },
  };
  return { ctx, emitted, published };
}
