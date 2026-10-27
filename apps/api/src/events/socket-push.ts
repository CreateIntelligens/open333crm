/**
 * Socket 推播的種類與房間（主規格 tenant-transaction-context「推播的房間由系統決定」）。
 *
 * 呼叫端只說「什麼東西變了」，房間由這裡決定。notifyTenant、notifyAgent 收 inTenant() 的 scope，
 * 由入口（flow、背景工作）呼叫，service 不呼叫（change migrate-role-agent-tenant-ctx，決策 6）。
 * 推播在 commit 之後送出，rollback 時丟棄；最多一次，失敗只記 log，不補送。房間命名、租戶檢查（#342），
 * 以及之後的渠道可見範圍（AUDIT RBAC-04）都集中在這個檔案。
 *
 * 不提供 conversation: 房間：沒有任何連線加入這個房間（#337 規劃第 8 節）。
 * 舊的 agent:<agentId> 房間沒有租戶 ID，新寫法不推到那裡。
 */
import type { Server } from 'socket.io';
import type { TenantScope } from '../lib/tenant-ctx.js';

/** 全租戶推播：送到交易綁定租戶的 tenant: 房間 */
export type TenantPushName =
  | 'message.new'
  | 'conversation.updated'
  | 'conversation.created'
  | 'case.created'
  | 'case.updated'
  | 'case.deleted'
  | 'contact.merged'
  | 'contact.merge_reverted'
  | 'link.stats.updated'
  /** 券發出、顧客開啟、核銷：收件匣「已發優惠券」重新載入（add-coupon-system design D23） */
  | 'coupon.instance.updated';

/** 給單一客服人員的推播：送到帶租戶 ID 的成員房間 */
export type AgentPushName = 'notification.new';

export function tenantPushRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * 成員連線時，伺服器依 token 的身分加入這個房間（socket-room-handlers.ts）。
 * 房間帶租戶 ID，所以 agentId 屬於別的租戶時，推播也只會到本租戶的房間，沒有連線收到。
 */
export function agentPushRoom(tenantId: string, agentId: string): string {
  return `tenant:${tenantId}:agent:${agentId}`;
}

/** commit 之後推播到本租戶的房間 */
export function notifyTenant(scope: TenantScope, io: Server, name: TenantPushName, data: unknown): void {
  const room = tenantPushRoom(scope.tenantId);
  scope.afterCommit(`push ${name}`, () => io.to(room).emit(name, data));
}

/** commit 之後推播給一位客服人員；房間帶 scope 綁定的租戶 ID，別的租戶的客服人員收不到 */
export function notifyAgent(scope: TenantScope, io: Server, agentId: string, name: AgentPushName, data: unknown): void {
  const room = agentPushRoom(scope.tenantId, agentId);
  scope.afterCommit(`push ${name}`, () => io.to(room).emit(name, data));
}
