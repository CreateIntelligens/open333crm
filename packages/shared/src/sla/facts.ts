import type { Priority } from '../types/case.types.js';
import { SLA_EVENT_DEFINITIONS, SLA_EVENT_NAMES } from './events.js';
import type { SlaEventName, SlaKind, SlaState } from './events.js';

export type SlaFactType = 'string' | 'number' | 'boolean' | 'datetime' | 'string_array';

export type SlaConditionOperator =
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'greaterThanInclusive'
  | 'lessThan'
  | 'lessThanInclusive'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'containsAny'
  | 'containsAll'
  | 'notContains'
  | 'exists'
  | 'notExists';

export interface SlaFactValueOption {
  value: string | number | boolean;
  label: string;
}

export interface SlaConditionFactDefinition {
  key: string;
  label: string;
  type: SlaFactType;
  operators: readonly SlaConditionOperator[];
  events?: readonly SlaEventName[];
  values?: readonly SlaFactValueOption[];
  optional?: boolean;
}

const comparableOperators = [
  'greaterThan',
  'greaterThanInclusive',
  'lessThan',
  'lessThanInclusive',
] as const;

const equalityOperators = ['equal', 'notEqual', 'in', 'notIn'] as const;

export const SLA_FACT_KEYS = {
  CASE_ID: 'case.id',
  CASE_STATUS: 'case.status',
  CASE_PRIORITY: 'case.priority',
  CASE_ASSIGNEE_ID: 'case.assigneeId',
  CASE_TEAM_ID: 'case.teamId',
  CASE_CUSTOMER_MESSAGES_SINCE_LAST_AGENT_REPLY:
    'case.customerMessagesSinceLastAgentReply',
  CASE_LAST_AGENT_REPLY_AT: 'case.lastAgentReplyAt',
  CASE_LAST_CUSTOMER_MESSAGE_AT: 'case.lastCustomerMessageAt',
  SLA_KIND: 'sla.kind',
  SLA_STATE: 'sla.state',
  SLA_DUE_AT: 'sla.dueAt',
  SLA_REMAINING_MINUTES: 'sla.remainingMinutes',
  SLA_OVERDUE_MINUTES: 'sla.overdueMinutes',
  SLA_WARNING_BEFORE_MINUTES: 'sla.warningBeforeMinutes',
  SLA_BREACH_COUNT: 'sla.breachCount',
  SLA_ESCALATION_LEVEL: 'sla.escalationLevel',
  CONTACT_IS_VIP: 'contact.isVip',
  CONTACT_TAGS: 'contact.tags',
  SENTIMENT_LATEST: 'sentiment.latest',
  SENTIMENT_NEGATIVE_COUNT: 'sentiment.negativeCount',
} as const;

export type SlaFactKey = (typeof SLA_FACT_KEYS)[keyof typeof SLA_FACT_KEYS];

const priorityOptions = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
] satisfies SlaFactValueOption[];

const statusOptions = [
  { value: 'OPEN', label: '開啟' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'PENDING', label: '等待中' },
  { value: 'ESCALATED', label: '已升級' },
] satisfies SlaFactValueOption[];

const slaKindOptions = [
  { value: 'first_response', label: '首次回應' },
  { value: 'resolution', label: '解決期限' },
  { value: 'customer_waiting', label: '客戶等待' },
] satisfies SlaFactValueOption[];

const slaStateOptions = [
  { value: 'normal', label: '正常' },
  { value: 'warning', label: '即將逾期' },
  { value: 'breached', label: '已逾期' },
] satisfies SlaFactValueOption[];

export const SLA_CONDITION_FACTS: readonly SlaConditionFactDefinition[] = [
  {
    key: SLA_FACT_KEYS.CASE_ID,
    label: '案件 ID',
    type: 'string',
    operators: ['equal', 'notEqual'],
  },
  {
    key: SLA_FACT_KEYS.CASE_STATUS,
    label: '案件狀態',
    type: 'string',
    operators: equalityOperators,
    values: statusOptions,
  },
  {
    key: SLA_FACT_KEYS.CASE_PRIORITY,
    label: '案件優先級',
    type: 'string',
    operators: equalityOperators,
    values: priorityOptions,
  },
  {
    key: SLA_FACT_KEYS.CASE_ASSIGNEE_ID,
    label: '負責客服 ID',
    type: 'string',
    operators: ['equal', 'notEqual', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: SLA_FACT_KEYS.CASE_TEAM_ID,
    label: '團隊 ID',
    type: 'string',
    operators: ['equal', 'notEqual', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: SLA_FACT_KEYS.SLA_KIND,
    label: 'SLA 類型',
    type: 'string',
    operators: equalityOperators,
    values: slaKindOptions,
  },
  {
    key: SLA_FACT_KEYS.SLA_STATE,
    label: 'SLA 狀態',
    type: 'string',
    operators: equalityOperators,
    values: slaStateOptions,
  },
  {
    key: SLA_FACT_KEYS.SLA_DUE_AT,
    label: 'SLA 到期時間',
    type: 'datetime',
    operators: [...equalityOperators, ...comparableOperators],
    events: [
      SLA_EVENT_NAMES.FIRST_RESPONSE_WARNING,
      SLA_EVENT_NAMES.FIRST_RESPONSE_BREACHED,
      SLA_EVENT_NAMES.RESOLUTION_WARNING,
      SLA_EVENT_NAMES.RESOLUTION_BREACHED,
    ],
  },
  {
    key: SLA_FACT_KEYS.SLA_REMAINING_MINUTES,
    label: 'SLA 剩餘分鐘',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
    events: [
      SLA_EVENT_NAMES.FIRST_RESPONSE_WARNING,
      SLA_EVENT_NAMES.RESOLUTION_WARNING,
    ],
  },
  {
    key: SLA_FACT_KEYS.SLA_OVERDUE_MINUTES,
    label: 'SLA 逾期分鐘',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
    events: [
      SLA_EVENT_NAMES.FIRST_RESPONSE_BREACHED,
      SLA_EVENT_NAMES.RESOLUTION_BREACHED,
      SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED,
    ],
  },
  {
    key: SLA_FACT_KEYS.SLA_WARNING_BEFORE_MINUTES,
    label: '到期前預警分鐘',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: SLA_FACT_KEYS.SLA_BREACH_COUNT,
    label: 'SLA 逾期次數',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: SLA_FACT_KEYS.SLA_ESCALATION_LEVEL,
    label: 'SLA 升級層級',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: SLA_FACT_KEYS.CASE_CUSTOMER_MESSAGES_SINCE_LAST_AGENT_REPLY,
    label: '客服回覆後的客戶訊息數',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
    events: [SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED],
  },
  {
    key: SLA_FACT_KEYS.CASE_LAST_AGENT_REPLY_AT,
    label: '最後客服回覆時間',
    type: 'datetime',
    operators: ['equal', 'notEqual', 'exists', 'notExists', ...comparableOperators],
    events: [SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED],
    optional: true,
  },
  {
    key: SLA_FACT_KEYS.CASE_LAST_CUSTOMER_MESSAGE_AT,
    label: '最後客戶訊息時間',
    type: 'datetime',
    operators: ['equal', 'notEqual', 'exists', 'notExists', ...comparableOperators],
    events: [SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED],
    optional: true,
  },
  {
    key: SLA_FACT_KEYS.CONTACT_IS_VIP,
    label: '聯絡人是 VIP',
    type: 'boolean',
    operators: ['equal', 'notEqual'],
    values: [
      { value: true, label: '是' },
      { value: false, label: '否' },
    ],
  },
  {
    key: SLA_FACT_KEYS.CONTACT_TAGS,
    label: '聯絡人標籤',
    type: 'string_array',
    operators: ['contains', 'containsAny', 'containsAll'],
    optional: true,
  },
  {
    key: SLA_FACT_KEYS.SENTIMENT_LATEST,
    label: '最新情緒',
    type: 'string',
    operators: equalityOperators,
    values: [
      { value: 'positive', label: '正面' },
      { value: 'neutral', label: '中性' },
      { value: 'negative', label: '負面' },
    ],
    optional: true,
  },
  {
    key: SLA_FACT_KEYS.SENTIMENT_NEGATIVE_COUNT,
    label: '負面情緒次數',
    type: 'number',
    operators: [...equalityOperators, ...comparableOperators],
    optional: true,
  },
] as const;

export const SLA_CONDITION_FACT_MAP: ReadonlyMap<string, SlaConditionFactDefinition> =
  new Map(SLA_CONDITION_FACTS.map((fact) => [fact.key, fact]));

export function getSlaConditionFactsForEvent(
  eventName: SlaEventName,
): SlaConditionFactDefinition[] {
  return SLA_CONDITION_FACTS.filter(
    (fact) => !fact.events || fact.events.includes(eventName),
  );
}

export interface SlaFactsInput {
  caseId: string;
  tenantId: string;
  status: string;
  priority: Priority | string;
  assigneeId?: string | null;
  teamId?: string | null;
  kind: SlaKind;
  state: SlaState;
  dueAt?: Date | string | null;
  remainingMinutes?: number | null;
  overdueMinutes?: number | null;
  warningBeforeMinutes?: number | null;
  breachCount?: number | null;
  escalationLevel?: number | null;
  customerMessagesSinceLastAgentReply?: number | null;
  lastAgentReplyAt?: Date | string | null;
  lastCustomerMessageAt?: Date | string | null;
  contactIsVip?: boolean | null;
  contactTags?: string[] | null;
  sentimentLatest?: string | null;
  sentimentNegativeCount?: number | null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function buildSlaFacts(input: SlaFactsInput): Record<string, unknown> {
  return {
    [SLA_FACT_KEYS.CASE_ID]: input.caseId,
    'tenant.id': input.tenantId,
    [SLA_FACT_KEYS.CASE_STATUS]: input.status,
    [SLA_FACT_KEYS.CASE_PRIORITY]: input.priority,
    [SLA_FACT_KEYS.CASE_ASSIGNEE_ID]: input.assigneeId ?? null,
    [SLA_FACT_KEYS.CASE_TEAM_ID]: input.teamId ?? null,
    [SLA_FACT_KEYS.SLA_KIND]: input.kind,
    [SLA_FACT_KEYS.SLA_STATE]: input.state,
    [SLA_FACT_KEYS.SLA_DUE_AT]: toIso(input.dueAt),
    [SLA_FACT_KEYS.SLA_REMAINING_MINUTES]: input.remainingMinutes ?? null,
    [SLA_FACT_KEYS.SLA_OVERDUE_MINUTES]: input.overdueMinutes ?? null,
    [SLA_FACT_KEYS.SLA_WARNING_BEFORE_MINUTES]: input.warningBeforeMinutes ?? null,
    [SLA_FACT_KEYS.SLA_BREACH_COUNT]: input.breachCount ?? 0,
    [SLA_FACT_KEYS.SLA_ESCALATION_LEVEL]: input.escalationLevel ?? 0,
    [SLA_FACT_KEYS.CASE_CUSTOMER_MESSAGES_SINCE_LAST_AGENT_REPLY]:
      input.customerMessagesSinceLastAgentReply ?? 0,
    [SLA_FACT_KEYS.CASE_LAST_AGENT_REPLY_AT]: toIso(input.lastAgentReplyAt),
    [SLA_FACT_KEYS.CASE_LAST_CUSTOMER_MESSAGE_AT]: toIso(input.lastCustomerMessageAt),
    [SLA_FACT_KEYS.CONTACT_IS_VIP]: input.contactIsVip ?? false,
    [SLA_FACT_KEYS.CONTACT_TAGS]: input.contactTags ?? [],
    [SLA_FACT_KEYS.SENTIMENT_LATEST]: input.sentimentLatest ?? null,
    [SLA_FACT_KEYS.SENTIMENT_NEGATIVE_COUNT]: input.sentimentNegativeCount ?? 0,
  };
}

export const SLA_RULE_AUTHORING_CONTRACT = {
  events: SLA_EVENT_DEFINITIONS,
  facts: SLA_CONDITION_FACTS,
  operators: [
    'equal',
    'notEqual',
    'greaterThan',
    'greaterThanInclusive',
    'lessThan',
    'lessThanInclusive',
    'in',
    'notIn',
    'contains',
    'containsAny',
    'containsAll',
    'notContains',
    'exists',
    'notExists',
  ] as const,
} as const;
