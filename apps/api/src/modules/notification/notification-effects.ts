/**
 * 寫入站內通知並推播 notification.new 給收件成員。每個發站內通知的入口都用這裡的函式，
 * 推播內容與房間只寫在一個地方（AGENTS.md 結構規則 2）。
 */
import type { Server as SocketIOServer } from 'socket.io';
import type { TenantCtx, TenantScope } from '../../lib/tenant-ctx.js';
import { agentPushRoom, notifyAgent } from '../../events/socket-push.js';
import { recordNotification, type NotificationInput } from './notification.service.js';

/**
 * 在 inTenant() 的交易內寫入通知，commit 之後推播給收件成員（tenant:<tenantId>:agent:<agentId>）。
 * 交易 rollback 時通知與推播都作廢。收件成員已不存在或已停用時不寫入、不推播，回傳 null（#484）。
 */
export async function createAndDispatch(scope: TenantScope, io: SocketIOServer, input: NotificationInput) {
  const notification = await recordNotification(scope, input);
  if (notification) notifyAgent(scope, io, input.agentId, 'notification.new', notification);
  return notification;
}

/**
 * 只給還沒搬遷、手上沒有交易的呼叫端用（csat 的低分通知，ctx 包著自動 commit 的連線）：
 * 寫入已經 commit，所以立刻推播。搬遷 csat 時改用 createAndDispatch()，並刪除這個函式。
 * @deprecated 新程式用 createAndDispatch()。
 */
export async function createAndDispatchWithoutTransaction(ctx: TenantCtx, io: SocketIOServer, input: NotificationInput) {
  const notification = await recordNotification(ctx, input);
  if (notification) io.to(agentPushRoom(ctx.tenantId, input.agentId)).emit('notification.new', notification);
  return notification;
}
