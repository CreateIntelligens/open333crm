import { AUTOMATION_EVENT_NAMES } from './events.js';
import type { AutomationFactDefinition, AutomationValueOption } from './types.js';

const comparableOperators = [
  'greaterThan',
  'greaterThanInclusive',
  'lessThan',
  'lessThanInclusive',
] as const;

const equalityOperators = ['equal', 'notEqual', 'in', 'notIn'] as const;

const priorityOptions = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'URGENT', label: '緊急' },
] satisfies AutomationValueOption[];

const caseStatusOptions = [
  { value: 'OPEN', label: '開啟' },
  { value: 'IN_PROGRESS', label: '處理中' },
  { value: 'PENDING', label: '等待中' },
  { value: 'ESCALATED', label: '已升級' },
  { value: 'RESOLVED', label: '已解決' },
  { value: 'CLOSED', label: '已關閉' },
] satisfies AutomationValueOption[];

const conversationStatusOptions = [
  { value: 'ACTIVE', label: '進行中' },
  { value: 'PENDING', label: '等待中' },
  { value: 'CLOSED', label: '已關閉' },
] satisfies AutomationValueOption[];

const channelOptions = [
  { value: 'LINE', label: 'LINE' },
  { value: 'FB', label: 'Facebook' },
  { value: 'WEBCHAT', label: 'WebChat' },
] satisfies AutomationValueOption[];

const slaKindOptions = [
  { value: 'first_response', label: '首次回應' },
  { value: 'resolution', label: '解決期限' },
  { value: 'customer_waiting', label: '客戶等待' },
] satisfies AutomationValueOption[];

const slaStateOptions = [
  { value: 'normal', label: '正常' },
  { value: 'warning', label: '即將逾期' },
  { value: 'breached', label: '已逾期' },
] satisfies AutomationValueOption[];

export const AUTOMATION_FACT_KEYS = {
  CONTACT_NAME: 'contact.name',
  CONTACT_CHANNEL: 'contact.channel',
  CONTACT_TAGS: 'contact.tags',
  CONTACT_LANGUAGE: 'contact.language',
  CONTACT_IS_VIP: 'contact.isVip',
  LEGACY_IS_VIP_CUSTOMER: 'is_vip_customer',
  CASE_OPEN_COUNT: 'case.open.count',
  MESSAGE_TEXT: 'message.text',
  CONVERSATION_CHANNEL_TYPE: 'conversation.channelType',
  CONVERSATION_STATUS: 'conversation.status',
  CONVERSATION_ASSIGNED_TO_ID: 'conversation.assignedToId',
  CASE_ID: 'case.id',
  CASE_STATUS: 'case.status',
  CASE_PRIORITY: 'case.priority',
  CASE_ASSIGNEE_ID: 'case.assigneeId',
  CASE_TEAM_ID: 'case.teamId',
  CASE_CATEGORY: 'case.category',
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
  SENTIMENT_LATEST: 'sentiment.latest',
  SENTIMENT_NEGATIVE_COUNT: 'sentiment.negativeCount',
} as const;

export const AUTOMATION_FACT_DEFINITIONS: readonly AutomationFactDefinition[] = [
  {
    key: AUTOMATION_FACT_KEYS.CONTACT_NAME,
    label: '聯絡人名稱',
    type: 'string',
    requires: ['contact'],
    operators: ['equal', 'notEqual', 'contains'],
  },
  {
    key: AUTOMATION_FACT_KEYS.CONTACT_CHANNEL,
    label: '聯絡人渠道',
    type: 'string_array',
    requires: ['contact'],
    operators: ['contains', 'containsAny', 'containsAll'],
    values: channelOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.CONTACT_TAGS,
    label: '聯絡人標籤',
    type: 'string_array',
    requires: ['contact'],
    operators: ['contains', 'containsAny', 'containsAll'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CONTACT_LANGUAGE,
    label: '聯絡人語言',
    type: 'string',
    requires: ['contact'],
    operators: ['equal', 'notEqual', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CONTACT_IS_VIP,
    label: '聯絡人是 VIP',
    type: 'boolean',
    requires: ['contact'],
    operators: ['equal', 'notEqual'],
    values: [
      { value: true, label: '是' },
      { value: false, label: '否' },
    ],
  },
  {
    key: AUTOMATION_FACT_KEYS.LEGACY_IS_VIP_CUSTOMER,
    label: '是否 VIP 客戶',
    type: 'boolean',
    requires: ['contact'],
    operators: ['equal', 'notEqual'],
    values: [
      { value: true, label: '是' },
      { value: false, label: '否' },
    ],
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_OPEN_COUNT,
    label: '開啟案件數',
    type: 'number',
    requires: ['contact'],
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: AUTOMATION_FACT_KEYS.MESSAGE_TEXT,
    label: '訊息內容',
    type: 'string',
    requires: ['message'],
    operators: ['equal', 'notEqual', 'contains', 'notContains', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CONVERSATION_CHANNEL_TYPE,
    label: '對話渠道',
    type: 'string',
    requires: ['conversation'],
    operators: equalityOperators,
    values: channelOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.CONVERSATION_STATUS,
    label: '對話狀態',
    type: 'string',
    requires: ['conversation'],
    operators: equalityOperators,
    values: conversationStatusOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.CONVERSATION_ASSIGNED_TO_ID,
    label: '對話負責客服 ID',
    type: 'string',
    requires: ['conversation'],
    operators: ['equal', 'notEqual', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_ID,
    label: '案件 ID',
    type: 'string',
    requires: ['case'],
    operators: ['equal', 'notEqual'],
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_STATUS,
    label: '案件狀態',
    type: 'string',
    requires: ['case'],
    operators: equalityOperators,
    values: caseStatusOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_PRIORITY,
    label: '案件優先級',
    type: 'string',
    requires: ['case'],
    operators: equalityOperators,
    values: priorityOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_ASSIGNEE_ID,
    label: '負責客服 ID',
    type: 'string',
    requires: ['case'],
    operators: ['equal', 'notEqual', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_TEAM_ID,
    label: '團隊 ID',
    type: 'string',
    requires: ['case'],
    operators: ['equal', 'notEqual', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_CATEGORY,
    label: '案件分類',
    type: 'string',
    requires: ['case'],
    operators: ['equal', 'notEqual', 'contains', 'exists', 'notExists'],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_KIND,
    label: 'SLA 類型',
    type: 'string',
    requires: ['sla'],
    operators: equalityOperators,
    values: slaKindOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_STATE,
    label: 'SLA 狀態',
    type: 'string',
    requires: ['sla'],
    operators: equalityOperators,
    values: slaStateOptions,
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_DUE_AT,
    label: 'SLA 到期時間',
    type: 'datetime',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
    events: [
      AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_WARNING,
      AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_BREACHED,
      AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_WARNING,
      AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_BREACHED,
    ],
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_REMAINING_MINUTES,
    label: 'SLA 剩餘分鐘',
    type: 'number',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
    events: [
      AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_WARNING,
      AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_WARNING,
    ],
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_OVERDUE_MINUTES,
    label: 'SLA 逾期分鐘',
    type: 'number',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
    events: [
      AUTOMATION_EVENT_NAMES.SLA_FIRST_RESPONSE_BREACHED,
      AUTOMATION_EVENT_NAMES.SLA_RESOLUTION_BREACHED,
      AUTOMATION_EVENT_NAMES.SLA_CUSTOMER_WAITING_BREACHED,
    ],
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_WARNING_BEFORE_MINUTES,
    label: '到期前預警分鐘',
    type: 'number',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_BREACH_COUNT,
    label: 'SLA 逾期次數',
    type: 'number',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: AUTOMATION_FACT_KEYS.SLA_ESCALATION_LEVEL,
    label: 'SLA 升級層級',
    type: 'number',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_CUSTOMER_MESSAGES_SINCE_LAST_AGENT_REPLY,
    label: '客服回覆後的客戶訊息數',
    type: 'number',
    requires: ['case', 'sla'],
    operators: [...equalityOperators, ...comparableOperators],
    events: [AUTOMATION_EVENT_NAMES.SLA_CUSTOMER_WAITING_BREACHED],
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_LAST_AGENT_REPLY_AT,
    label: '最後客服回覆時間',
    type: 'datetime',
    requires: ['case', 'sla'],
    operators: ['equal', 'notEqual', 'exists', 'notExists', ...comparableOperators],
    events: [AUTOMATION_EVENT_NAMES.SLA_CUSTOMER_WAITING_BREACHED],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.CASE_LAST_CUSTOMER_MESSAGE_AT,
    label: '最後客戶訊息時間',
    type: 'datetime',
    requires: ['case', 'sla'],
    operators: ['equal', 'notEqual', 'exists', 'notExists', ...comparableOperators],
    events: [AUTOMATION_EVENT_NAMES.SLA_CUSTOMER_WAITING_BREACHED],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.SENTIMENT_LATEST,
    label: '最新情緒',
    type: 'string',
    requires: ['sla'],
    operators: equalityOperators,
    values: [
      { value: 'positive', label: '正面' },
      { value: 'neutral', label: '中性' },
      { value: 'negative', label: '負面' },
    ],
    optional: true,
  },
  {
    key: AUTOMATION_FACT_KEYS.SENTIMENT_NEGATIVE_COUNT,
    label: '負面情緒次數',
    type: 'number',
    requires: ['sla'],
    operators: [...equalityOperators, ...comparableOperators],
    optional: true,
  },
] as const;

export const AUTOMATION_FACT_MAP: ReadonlyMap<string, AutomationFactDefinition> =
  new Map(AUTOMATION_FACT_DEFINITIONS.map((fact) => [fact.key, fact]));
