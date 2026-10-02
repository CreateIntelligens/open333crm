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
  description?: string;
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
  | 'textarea';

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
  /**
   * 包含 workers 尚未支援的動作（AUDIT AUTO-01）。只給 workers 執行既有規則時用：
   * 驗證照常通過，執行時再個別跳過。規則編輯器與存檔驗證都不帶，所以不會提供、也存不進去。
   */
  allowUnsupportedActions?: boolean;
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
