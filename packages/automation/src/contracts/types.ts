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
  | 'agent'
  /** 素材 ID。編輯器顯示素材庫讓人選，不要求填 ID */
  | 'material'
  /** 優惠券 ID。只列進行中的券讓人選，不要求填 ID（add-coupon-system design D25） */
  | 'coupon';

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
  /**
   * true：自動化規則編輯器不列在動作選單，既有規則上的這個動作以唯讀顯示、可刪除。
   * 動作仍在契約內，既有規則照常通過驗證並執行（add-coupon-system design D25）。
   */
  editorHidden?: boolean;
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
