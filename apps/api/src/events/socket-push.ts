/**
 * Socket 推播的種類與房間（主規格 tenant-transaction-context「推播的房間由系統決定」）。
 *
 * 呼叫端只說「什麼東西變了」，房間由這裡決定。notifyTenant、notifyChannel、notifyAgent 收 inTenant() 的 scope，
 * 由入口（flow、背景工作）呼叫，service 不呼叫（change migrate-role-agent-tenant-ctx，決策 6）。
 * 推播在 commit 之後送出，rollback 時丟棄；最多一次，失敗只記 log，不補送。房間命名、租戶檢查（#342），
 * 以及渠道可見範圍（issue #427，AUDIT RBAC-04）都集中在這個檔案。
 *
 * 渠道相關的推播（訊息內容、對話更新）只送到渠道房間，不送到全租戶房間：沒有渠道授權的成員
 * 不會從 socket 收到其他渠道的訊息。房間名稱見 @open333crm/shared 的 socket-rooms（workers 共用）。
 *
 * 舊的 agent:<agentId> 房間沒有租戶 ID，新寫法不推到那裡。
 */
import type { Server } from 'socket.io';
import { channelPushRooms, tenantRoom } from '@open333crm/shared';
import type { TenantScope } from '../lib/tenant-ctx.js';

/** 全租戶推播：送到交易綁定租戶的 tenant: 房間。內容不可帶渠道的訊息或對話資料（那些用 ChannelPushName） */
export type TenantPushName =
  | 'case.created'
  | 'case.updated'
  | 'case.deleted'
  | 'contact.merged'
  | 'contact.merge_reverted'
  | 'link.stats.updated'
  /** 券發出、顧客開啟、核銷：收件匣「已發優惠券」重新載入（add-coupon-system design D23） */
  | 'coupon.instance.updated';

/** 渠道推播：只送給看得到該渠道的成員（渠道房間與總店房間） */
export type ChannelPushName =
  | 'message.new'
  | 'conversation.updated'
  | 'conversation.created';

/** 給單一客服人員的推播：送到帶租戶 ID 的成員房間 */
export type AgentPushName = 'notification.new';

/** emitToChannel 用到的 Socket.IO 方法（Server 與測試替身都符合） */
export interface ChannelEmitter {
  to(rooms: string[]): { emit(event: string, payload: unknown): unknown };
}

/** 渠道推播的對象：渠道，以及（有的話）對話；對話房間由已授權的 subscribe 加入 */
export interface ChannelPushTarget {
  channelId: string;
  conversationId?: string | null;
}

export function tenantPushRoom(tenantId: string): string {
  return tenantRoom(tenantId);
}

/**
 * 成員連線時，伺服器依 token 的身分加入這個房間（socket-room-handlers.ts）。
 * 房間帶租戶 ID，所以 agentId 屬於別的租戶時，推播也只會到本租戶的房間，沒有連線收到。
 */
export function agentPushRoom(tenantId: string, agentId: string): string {
  return `tenant:${tenantId}:agent:${agentId}`;
}

/**
 * 渠道推播送到的房間：對話房間（有的話）、渠道房間、總店房間。
 * 用一次 io.to([...]) 送出，同一個連線在多個房間也只收到一次。
 */
export function channelPushTargetRooms(tenantId: string, target: ChannelPushTarget): string[] {
  const rooms = channelPushRooms(tenantId, target.channelId);
  return target.conversationId ? [`conversation:${target.conversationId}`, ...rooms] : rooms;
}

/** commit 之後推播到本租戶的房間 */
export function notifyTenant(scope: TenantScope, io: Server, name: TenantPushName, data: unknown): void {
  const room = tenantPushRoom(scope.tenantId);
  scope.afterCommit(`push ${name}`, () => io.to(room).emit(name, data));
}

/** commit 之後推播給看得到該渠道的成員 */
export function notifyChannel(
  scope: TenantScope,
  io: Server,
  target: ChannelPushTarget,
  name: ChannelPushName,
  data: unknown,
): void {
  const rooms = channelPushTargetRooms(scope.tenantId, target);
  scope.afterCommit(`push ${name}`, () => io.to(rooms).emit(name, data));
}

/**
 * 立即推播給看得到該渠道的成員。只給還沒搬到 inTenant() 的舊入口用（#337）：
 * 它們不在交易內，或在交易內直接推播。新程式用 notifyChannel。
 */
export function emitToChannel(
  io: ChannelEmitter,
  tenantId: string,
  target: ChannelPushTarget,
  name: ChannelPushName,
  data: unknown,
): void {
  io.to(channelPushTargetRooms(tenantId, target)).emit(name, data);
}

/**
 * 重新計算已連線 socket 的渠道房間（socket plugin 提供，fastify.syncSocketChannelRooms）。
 * 給 agentId 時只算該成員，否則算整個租戶。失敗只記 log，不丟錯。
 */
export type SocketChannelRoomSync = (tenantId: string, agentId?: string) => Promise<void>;

/**
 * commit 之後重新計算渠道房間（issue #427）：成員可用渠道、角色、角色權限、渠道授權改變時呼叫，
 * 已連線的成員不必重新連線就依新的授權收推播。不給 agentId 時重新計算整個租戶。
 * 沒有 sync（測試替身或沒有 socket 的行程）時不做事。
 */
export function resyncChannelRooms(scope: TenantScope, sync: SocketChannelRoomSync | undefined, agentId?: string): void {
  if (!sync) return;
  scope.afterCommit('sync socket channel rooms', () => sync(scope.tenantId, agentId));
}

/** commit 之後推播給一位客服人員；房間帶 scope 綁定的租戶 ID，別的租戶的客服人員收不到 */
export function notifyAgent(scope: TenantScope, io: Server, agentId: string, name: AgentPushName, data: unknown): void {
  const room = agentPushRoom(scope.tenantId, agentId);
  scope.afterCommit(`push ${name}`, () => io.to(room).emit(name, data));
}
