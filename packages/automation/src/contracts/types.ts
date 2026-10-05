export type AutomationScope =
  | 'tenant'
  | 'contact'
  | 'conversation'
  | 'message'
  | 'case'
  | 'sla'
  | 'agent'
  | 'team';

export type AutomationEventCategory =
  | 'message'
  | 'conversation'
  | 'case'
  | 'contact'
  | 'sla';

export type AutomationFactType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'string_array';

export type AutomationOperator =
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

export interface AutomationValueOption {
  value: string | number | boolean;
  label: string;
}

export interface AutomationOperatorDefinition {
  name: AutomationOperator;
  label: string;
  requiresValue: boolean;
}

export interface AutomationEventDefinition {
  name: string;
  label: string;
  /** 給管理員看的說明，顯示在規則編輯器的觸發事件下方 */
  description?: string;
  /**
   * false：系統目前不會送出這個事件（AUDIT AUTO-05），以它觸發的規則永遠不會執行。
   * 編輯器據此標示「目前不會觸發」。省略表示會送出。
   */
  dispatched?: boolean;
  category: AutomationEventCategory;
  provides: readonly AutomationScope[];
  resolvable?: readonly AutomationScope[];
}

export interface AutomationFactDefinition {
  key: string;
  label: string;
  type: AutomationFactType;
  requires: readonly AutomationScope[];
  operators: readonly AutomationOperator[];
  values?: readonly AutomationValueOption[];
  events?: readonly string[];
  optional?: boolean;
}

export type AutomationActionParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'textarea'
  /** 客服 ID。編輯器顯示客服名單讓人選，不要求填 ID */
  | 'agent';

export interface AutomationActionParamDefinition {
  key: string;
  label: string;
  type: AutomationActionParamType;
  required?: boolean;
  placeholder?: string;
  values?: readonly AutomationValueOption[];
}

export interface AutomationActionDefinition {
  type: string;
  label: string;
  requires: readonly AutomationScope[];
  mutates: readonly AutomationScope[];
  params?: readonly AutomationActionParamDefinition[];
}

export interface ComposeAutomationContractOptions {
  enabledResolvers?: readonly AutomationScope[];
}

export interface ComposedAutomationContract {
  event: AutomationEventDefinition;
  scopes: readonly AutomationScope[];
  facts: AutomationFactDefinition[];
  actions: AutomationActionDefinition[];
  operators: readonly AutomationOperatorDefinition[];
}

export interface AutomationContractValidationResult {
  valid: boolean;
  errors: string[];
}
