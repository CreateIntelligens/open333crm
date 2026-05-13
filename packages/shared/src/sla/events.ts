export const SLA_EVENT_NAMES = {
  FIRST_RESPONSE_WARNING: 'sla.first_response.warning',
  FIRST_RESPONSE_BREACHED: 'sla.first_response.breached',
  RESOLUTION_WARNING: 'sla.resolution.warning',
  RESOLUTION_BREACHED: 'sla.resolution.breached',
  CUSTOMER_WAITING_BREACHED: 'sla.customer_waiting.breached',
} as const;

export type SlaEventName = (typeof SLA_EVENT_NAMES)[keyof typeof SLA_EVENT_NAMES];

export type SlaKind = 'first_response' | 'resolution' | 'customer_waiting';
export type SlaState = 'normal' | 'warning' | 'breached';

export interface SlaEventDefinition {
  name: SlaEventName;
  label: string;
  description: string;
  kind: SlaKind;
}

export const SLA_EVENT_DEFINITIONS: readonly SlaEventDefinition[] = [
  {
    name: SLA_EVENT_NAMES.FIRST_RESPONSE_WARNING,
    label: '首次回應即將逾期',
    description: '首次回應期限即將到期。',
    kind: 'first_response',
  },
  {
    name: SLA_EVENT_NAMES.FIRST_RESPONSE_BREACHED,
    label: '首次回應已逾期',
    description: '首次回應期限已過，且尚未有客服回應。',
    kind: 'first_response',
  },
  {
    name: SLA_EVENT_NAMES.RESOLUTION_WARNING,
    label: '解決期限即將逾期',
    description: '案件解決期限即將到期。',
    kind: 'resolution',
  },
  {
    name: SLA_EVENT_NAMES.RESOLUTION_BREACHED,
    label: '解決期限已逾期',
    description: '案件解決期限已過。',
    kind: 'resolution',
  },
  {
    name: SLA_EVENT_NAMES.CUSTOMER_WAITING_BREACHED,
    label: '客戶等待已逾期',
    description: '同一案件中，客戶已連續發送過多訊息且客服尚未回覆。',
    kind: 'customer_waiting',
  },
] as const;

export const SLA_EVENT_NAME_SET: ReadonlySet<string> = new Set(
  SLA_EVENT_DEFINITIONS.map((event) => event.name),
);

export function isSlaEventName(value: string): value is SlaEventName {
  return SLA_EVENT_NAME_SET.has(value);
}
