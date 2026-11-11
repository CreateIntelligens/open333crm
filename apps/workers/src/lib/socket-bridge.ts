import type { Redis as IORedis } from 'ioredis';
import { channelPushRooms } from '@open333crm/shared';

const SOCKET_EMIT_CHANNEL = 'socket:emit';

/**
 * `socket:emit` 的訊息（主規格 core-inbox「socket:emit Message Shape」）。
 * `room` 給一個房間；`rooms` 給多個房間，API 以一次 io.to(rooms) 送出，同一個連線只收到一次。
 */
export interface SocketEmitPayload {
  room?: string;
  rooms?: string[];
  event: string;
  data: unknown;
}

export async function publishSocketEvent(
  redis: IORedis,
  room: string,
  event: string,
  data: unknown,
): Promise<void> {
  const payload: SocketEmitPayload = { room, event, data };
  await redis.publish(SOCKET_EMIT_CHANNEL, JSON.stringify(payload));
}

/** 渠道相關的推播（訊息內容、對話更新）：只送給看得到該渠道的成員，不送到全租戶房間（issue #427） */
export type ChannelSocketEvent = 'message.new' | 'conversation.updated' | 'automation.executed';

/**
 * 推播給看得到該渠道的成員：對話房間（有的話）、渠道房間、總店房間。
 * 房間名稱與 API 共用 @open333crm/shared 的 socket-rooms。
 */
export async function publishChannelSocketEvent(
  redis: IORedis,
  target: { tenantId: string; channelId: string; conversationId?: string | null },
  event: ChannelSocketEvent,
  data: unknown,
): Promise<void> {
  const rooms = channelPushRooms(target.tenantId, target.channelId);
  const payload: SocketEmitPayload = {
    rooms: target.conversationId ? [`conversation:${target.conversationId}`, ...rooms] : rooms,
    event,
    data,
  };
  await redis.publish(SOCKET_EMIT_CHANNEL, JSON.stringify(payload));
}

export { SOCKET_EMIT_CHANNEL };
