/**
 * 寫入站內通知並推播 notification.new 給收件成員。每個發站內通知的入口都用這裡的函式，
 * 推播內容與房間只寫在一個地方（AGENTS.md 結構規則 2）。
 */
import type { Server as SocketIOServer } from 'socket.io';
import type { TenantScope } from '../../lib/tenant-ctx.js';
import { notifyAgent } from '../../events/socket-push.js';
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
