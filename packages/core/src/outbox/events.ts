/**
 * 業務事件的名稱與對外事件清單（change outbox-event-delivery，design 決策 11）。
 * api 的 event-bus.ts 與 workers 都從這裡取得名稱，outbox 依名稱決定送給哪些訂閱者。
 */
export const APP_EVENT_NAMES = [
  'message.received',
  'message.sent',
  'conversation.created',
  'conversation.updated',
  'conversation.assigned',
  'conversation.closed',
  'case.created',
  'case.updated',
  'case.assigned',
  'case.escalated',
  'case.resolved',
  'case.closed',
  'contact.created',
  'contact.updated',
  'contact.tagged',
  'keyword.matched',
  'sentiment.negative',
  'conversation.handoff',
  'sla.warning',
  'sla.breached',
  'portal.activity.submitted',
  'link.clicked',
  'usage.quota.threshold',
] as const;

export type AppEventName = (typeof APP_EVENT_NAMES)[number];

/**
 * 會轉送給租戶 webhook 訂閱網址的事件。第一版等於所有事件名稱；
 * 要不要縮減、`message.received` 的 replyToken 要不要拿掉，待產品決定（AUDIT HOOK-01）。
 */
export const EXTERNAL_EVENT_NAMES: ReadonlySet<string> = new Set<string>(APP_EVENT_NAMES);
