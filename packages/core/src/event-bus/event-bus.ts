import { redis } from '../redis/client.js';
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
    const sub = redis.duplicate();
    sub.subscribe(this.CHANNEL);
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
