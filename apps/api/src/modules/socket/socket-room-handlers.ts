import type { SocketRoomAuthorizationResult } from './socket-room-authorization.js';
import {
  consumeSocketSubscriptionAttempt,
  SOCKET_SUBSCRIPTION_RATE_WINDOW_MS,
  type SocketSubscriptionRateLimitState,
} from './socket-subscription-rate-limit.js';

type Ack = (response: unknown) => void;

/** registerRoomHandlers 用到的 Socket.IO socket 方法 */
export interface RoomSocket {
  join(room: string): unknown;
  leave(room: string): unknown;
  on(event: 'subscribe' | 'unsubscribe', listener: (input: unknown, ack?: Ack) => void): unknown;
}

export interface RoomLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

const MESSAGES = {
  subscribe: {
    rateLimited: 'Socket subscription rate limit exceeded',
    rejected: 'Socket subscription rejected',
    done: 'Socket subscribing to room',
    failed: 'Socket subscription authorization failed',
  },
  unsubscribe: {
    rateLimited: 'Socket unsubscription rate limit exceeded',
    rejected: 'Socket unsubscription rejected',
    done: 'Socket unsubscribing from room',
    failed: 'Socket unsubscription authorization failed',
  },
} as const;

/**
 * 成員連線後的房間處理（主規格 socket-room-authorization）：
 * 加入自己的租戶與成員房間；subscribe／unsubscribe 先計次，再經伺服器授權，通過才加入或離開房間。
 */
export function registerRoomHandlers(
  socket: RoomSocket,
  identity: { agentId: string; tenantId: string },
  authorize: (input: unknown) => Promise<SocketRoomAuthorizationResult>,
  log: RoomLogger,
): void {
  const { agentId, tenantId } = identity;

  // Auto-join tenant room and agent-specific room
  socket.join(`tenant:${tenantId}`);
  socket.join(`agent:${agentId}`);

  // subscribe 與 unsubscribe 共用同一個計數
  let subscriptionRateState: SocketSubscriptionRateLimitState = {
    count: 0,
    resetAt: Date.now() + SOCKET_SUBSCRIPTION_RATE_WINDOW_MS,
  };

  for (const event of ['subscribe', 'unsubscribe'] as const) {
    const msg = MESSAGES[event];
    socket.on(event, async (input: unknown, ack?: Ack) => {
      const rateResult = consumeSocketSubscriptionAttempt(subscriptionRateState);
      subscriptionRateState = rateResult.state;
      if (!rateResult.allowed) {
        log.warn({ agentId }, msg.rateLimited);
        ack?.({ ok: false, code: 'RATE_LIMITED' });
        return;
      }

      try {
        const result = await authorize(input);
        if (!result.ok) {
          log.warn({ agentId, code: result.code }, msg.rejected);
          ack?.(result);
          return;
        }

        log.info({ agentId, room: result.room }, msg.done);
        if (event === 'subscribe') await socket.join(result.room);
        else await socket.leave(result.room);
        ack?.(result);
      } catch (err) {
        log.warn({ agentId, err }, msg.failed);
        ack?.({ ok: false, code: 'FORBIDDEN' });
      }
    });
  }
}
