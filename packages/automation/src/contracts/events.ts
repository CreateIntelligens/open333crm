import type { AutomationEventDefinition } from './types.js';

export const AUTOMATION_EVENT_NAMES = {
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_POSTBACK: 'message.postback',
  KEYWORD_MATCHED: 'keyword.matched',
  CONVERSATION_CREATED: 'conversation.created',
  CASE_CREATED: 'case.created',
  CASE_UPDATED: 'case.updated',
  CASE_ESCALATED: 'case.escalated',
  CASE_CLOSED: 'case.closed',
  CASE_STATUS_CHANGED: 'case.status_changed',
  CASE_ASSIGNED: 'case.assigned',
  CONTACT_CREATED: 'contact.created',
  CONTACT_UPDATED: 'contact.updated',
  CONTACT_TAGGED: 'contact.tagged',
  LINK_CLICKED: 'link.clicked',
  SLA_FIRST_RESPONSE_WARNING: 'sla.first_response.warning',
  SLA_FIRST_RESPONSE_BREACHED: 'sla.first_response.breached',
  SLA_RESOLUTION_WARNING: 'sla.resolution.warning',
  SLA_RESOLUTION_BREACHED: 'sla.resolution.breached',
  SLA_CUSTOMER_WAITING_BREACHED: 'sla.customer_waiting.breached',
} as const;

export type AutomationEventName =
  (typeof AUTOMATION_EVENT_NAMES)[keyof typeof AUTOMATION_EVENT_NAMES];

const messageScopes = ['tenant', 'contact', 'conversation', 'message'] as const;
const caseScopes = ['tenant', 'contact', 'case'] as const;
const contactScopes = ['tenant', 'contact'] as const;
const conversationScopes = ['tenant', 'contact', 'conversation'] as const;
const slaScopes = ['tenant', 'contact', 'case', 'sla'] as const;

export const AUTOMATION_EVENT_DEFINITIONS: readonly AutomationEventDefinition[] = [
  {
    name: AUTOMATION_EVENT_NAMES.MESSAGE_RECEIVED,
    label: '收到訊息',
    description: '客人從任何渠道傳來一則訊息時。',
    category: 'message',
    provides: messageScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.MESSAGE_POSTBACK,
    label: '收到 Postback',
    description: '客人點了 LINE 訊息上的按鈕時。',
    dispatched: false,
    category: 'message',
    provides: messageScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.KEYWORD_MATCHED,
    label: '關鍵字命中',
    description: '客人的訊息含有你設定的關鍵字時。',
    category: 'message',
    provides: messageScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONVERSATION_CREATED,
    label: '新對話建立',
    description: '有新的客人第一次傳訊息、開啟新對話時。',
    category: 'conversation',
    provides: conversationScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_CREATED,
    label: '工單建立',
    description: '建立一張新工單時，不論是客服手動建立或規則自動建立。',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_UPDATED,
    label: '工單更新',
    description: '工單的內容被修改時。',
    dispatched: false,
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_ESCALATED,
    label: '工單升級',
    description: '工單被升級、需要主管處理時。',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_CLOSED,
    label: '工單關閉',
    description: '工單處理完畢、被關閉時。',
    dispatched: false,
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_STATUS_CHANGED,
    label: '工單狀態變更',
    description: '工單狀態改變時，例如從處理中改為已解決。',
    dispatched: false,
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_ASSIGNED,
    label: '工單指派',
    description: '工單被指派給客服時。',
    dispatched: false,
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONTACT_CREATED,
    label: '聯繫人建立',
    description: '系統新增一位聯絡人時。',
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONTACT_UPDATED,
    label: '聯繫人更新',
    description: '聯絡人的資料被修改時。',
    dispatched: false,
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONTACT_TAGGED,
    label: '聯繫人加標籤',
    description: '聯絡人被貼上標籤時。',
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.LINK_CLICKED,
    label: '短連結被點擊',
    description: '聯絡人點了你發出的短連結時，可以依是哪一條連結決定要做什麼。',
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_WARNING,
    label: 'SLA - 首次回應即將逾期',
    description: '工單的首次回應期限快到了，客服還沒回覆時。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_BREACHED,
    label: 'SLA - 首次回應已逾期',
    description: '工單的首次回應期限已經過了，客服還沒回覆時。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_WARNING,
    label: 'SLA - 解決期限即將逾期',
    description: '工單的解決期限快到了，還沒解決時。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_BREACHED,
    label: 'SLA - 解決期限已逾期',
    description: '工單的解決期限已經過了，還沒解決時。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_CUSTOMER_WAITING_BREACHED,
    label: 'SLA - 客戶等待已逾期',
    description: '客人等待客服回覆的時間超過 SLA 設定時。',
    category: 'sla',
    provides: slaScopes,
  },
] as const;

export const AUTOMATION_EVENT_MAP: ReadonlyMap<string, AutomationEventDefinition> =
  new Map(AUTOMATION_EVENT_DEFINITIONS.map((event) => [event.name, event]));

export function isAutomationEventName(value: string): value is AutomationEventName {
  return AUTOMATION_EVENT_MAP.has(value);
}
