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
    category: 'message',
    provides: messageScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.MESSAGE_POSTBACK,
    label: '收到 Postback',
    category: 'message',
    provides: messageScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.KEYWORD_MATCHED,
    label: '關鍵字命中',
    category: 'message',
    provides: messageScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONVERSATION_CREATED,
    label: '新對話建立',
    category: 'conversation',
    provides: conversationScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_CREATED,
    label: '工單建立',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_UPDATED,
    label: '工單更新',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_ESCALATED,
    label: '工單升級',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_CLOSED,
    label: '工單關閉',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_STATUS_CHANGED,
    label: '工單狀態變更',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CASE_ASSIGNED,
    label: '工單指派',
    category: 'case',
    provides: caseScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONTACT_CREATED,
    label: '聯繫人建立',
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONTACT_UPDATED,
    label: '聯繫人更新',
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.CONTACT_TAGGED,
    label: '聯繫人加標籤',
    category: 'contact',
    provides: contactScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_WARNING,
    label: 'SLA - 首次回應即將逾期',
    description: '首次回應期限即將到期。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_BREACHED,
    label: 'SLA - 首次回應已逾期',
    description: '首次回應期限已過，且尚未有客服回應。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_WARNING,
    label: 'SLA - 解決期限即將逾期',
    description: '案件解決期限即將到期。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_BREACHED,
    label: 'SLA - 解決期限已逾期',
    description: '案件解決期限已過。',
    category: 'sla',
    provides: slaScopes,
  },
  {
    name: AUTOMATION_EVENT_NAMES.SLA_CUSTOMER_WAITING_BREACHED,
    label: 'SLA - 客戶等待已逾期',
    description: '同一案件中，客戶已連續發送過多訊息且客服尚未回覆。',
    category: 'sla',
    provides: slaScopes,
  },
] as const;

export const AUTOMATION_EVENT_MAP: ReadonlyMap<string, AutomationEventDefinition> =
  new Map(AUTOMATION_EVENT_DEFINITIONS.map((event) => [event.name, event]));

export function isAutomationEventName(value: string): value is AutomationEventName {
  return AUTOMATION_EVENT_MAP.has(value);
}
