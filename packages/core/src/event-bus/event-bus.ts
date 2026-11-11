import { redis, REDIS_URL } from '../redis/client.js';
import { createRedisClient } from '../redis/create-client.js';
import { logger } from '../logger/index.js';

export interface BaseEvent {
  tenantId: string;
  type: string;
  payload: any;
  timestamp: number;
}

export class EventBus {
  private static CHANNEL = 'crm:events';

  static async publish(event: BaseEvent) {
    try {
      const message = JSON.stringify(event);
      await redis.publish(this.CHANNEL, message);
      logger.debug(`Published event: ${event.type} for tenant ${event.tenantId}`);
    } catch (err) {
      logger.error('Failed to publish event:', err);
    }
  }

  static subscribe(callback: (event: BaseEvent) => void) {
    // 訂閱連線不能複製一般用途的 redis：會繼承 commandTimeout，Redis 啟動時無法使用的話 SUBSCRIBE 會失敗、訂閱消失
    const sub = createRedisClient(REDIS_URL, 'queue');
    sub.subscribe(this.CHANNEL).catch((err: unknown) => logger.error('Failed to subscribe event bus:', err));
    sub.on('message', (channel: string, message: string) => {
      if (channel === this.CHANNEL) {
        try {
          const event = JSON.parse(message) as BaseEvent;
          callback(event);
        } catch (err) {
          logger.error('Failed to parse event message:', err);
        }
      }
    });
    return sub;
  }
}
