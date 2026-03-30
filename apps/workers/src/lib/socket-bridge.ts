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
