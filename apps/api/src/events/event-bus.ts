/**
 * 還沒搬到 ctx.publish 的程式發出業務事件的地方（change outbox-event-delivery，design 決策 7）。
 *
 * publish() 產生一個事件 id，直接送進訂閱了這個事件的訂閱者佇列，不寫 outbox。
 * 所以保證仍是最多一次：行程在送出之前結束時，事件遺失。搬到 ctx.publish 之後才是至少一次。
 *
 * 訂閱者（通知、自動化、對外 webhook）從佇列取得事件，不訂閱這裡。publish() 仍在行程內 emit，
 * 只讓測試以 subscribe() 觀察發出的事件；正式程式不要以 subscribe() 處理事件。
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  getOutboxQueue,
  logger,
  SUBSCRIBER_JOB_OPTIONS,
  subscriberQueuesOf,
  type AppEventName,
  type EventJobData,
} from '@open333crm/core';

export type { AppEventName } from '@open333crm/core';

export interface AppEvent {
  name: AppEventName;
  tenantId: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

/** 訂閱者 job 的資料轉回 AppEvent：job data 是 JSON，timestamp 是 ISO 8601 字串 */
export function appEventFromJob(data: EventJobData): AppEvent & { id: string } {
  return {
    id: data.eventId,
    name: data.name as AppEventName,
    tenantId: data.tenantId,
    timestamp: new Date(data.timestamp),
    payload: data.payload,
  };
}

class AppEventBus extends EventEmitter {
  private static instance: AppEventBus;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  static getInstance(): AppEventBus {
    if (!AppEventBus.instance) {
      AppEventBus.instance = new AppEventBus();
    }
    return AppEventBus.instance;
  }

  publish(event: AppEvent): void {
    const eventId = randomUUID();
    const data: EventJobData = {
      eventId,
      name: event.name,
      tenantId: event.tenantId,
      timestamp: event.timestamp.toISOString(),
      payload: event.payload,
    };
    for (const queue of subscriberQueuesOf(event.name)) {
      // 不 await：呼叫端是同步的舊程式。失敗只記 log，事件遺失（最多一次）
      getOutboxQueue(queue)
        .add(event.name, data, { ...SUBSCRIBER_JOB_OPTIONS, jobId: eventId })
        .catch((err: unknown) => logger.error(`[eventBus] 送進 ${queue} 失敗，事件遺失（${event.name}）`, err));
    }
    this.emit(event.name, event);
    this.emit('*', event);
  }

  /** 只給測試觀察 publish() 發出的事件 */
  subscribe(eventName: AppEventName | '*', handler: (event: AppEvent) => void): void {
    this.on(eventName, handler);
  }

  unsubscribe(eventName: AppEventName | '*', handler: (event: AppEvent) => void): void {
    this.off(eventName, handler);
  }
}

export const eventBus = AppEventBus.getInstance();
