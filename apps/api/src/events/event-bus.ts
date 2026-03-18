import { EventEmitter } from 'node:events';

/**
 * Type-safe event names for the application event bus.
 */
export type AppEventName =
  | 'message.received'
  | 'message.sent'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.assigned'
  | 'case.created'
  | 'case.updated'
  | 'case.assigned'
  | 'case.escalated'
  | 'case.resolved'
  | 'case.closed'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.tagged'
  | 'keyword.matched'
  | 'sla.warning'
  | 'sla.breached';

export interface AppEvent {
  name: AppEventName;
  tenantId: string;
  timestamp: Date;
  payload: Record<string, unknown>;
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
    this.emit(event.name, event);
    this.emit('*', event); // wildcard listener
  }

  subscribe(eventName: AppEventName | '*', handler: (event: AppEvent) => void): void {
    this.on(eventName, handler);
  }

  unsubscribe(eventName: AppEventName | '*', handler: (event: AppEvent) => void): void {
    this.off(eventName, handler);
  }
}

export const eventBus = AppEventBus.getInstance();
