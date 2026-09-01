import type IORedis from 'ioredis';

const SOCKET_EMIT_CHANNEL = 'socket:emit';

export interface SocketEmitPayload {
  room: string;
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

export { SOCKET_EMIT_CHANNEL };

// ── Domain event bridge：worker → api in-process eventBus ──────────────────
// worker 是獨立 process，無法直接發到 api 的 in-process eventBus（automation 規則
// 訂閱的那個）。透過 redis 這條 channel 發，api 端 subscriber 轉成 eventBus 事件。
const DOMAIN_EVENT_CHANNEL = 'domain:event';

export interface DomainEventPayload {
  name: string;
  tenantId: string;
  payload: Record<string, unknown>;
}

export async function publishDomainEvent(
  redis: IORedis,
  name: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const msg: DomainEventPayload = { name, tenantId, payload };
  await redis.publish(DOMAIN_EVENT_CHANNEL, JSON.stringify(msg));
}

export { DOMAIN_EVENT_CHANNEL };
