import {
  composeAutomationContract,
  getAutomationActionForEvent,
  getAutomationFactForEvent,
} from './composer.js';
import { AUTOMATION_OPERATOR_MAP } from './operators.js';
import type {
  AutomationActionDefinition,
  AutomationContractValidationResult,
  AutomationOperator,
  ComposeAutomationContractOptions,
} from './types.js';
import { AUTOMATION_ACTION_MAP } from './actions.js';
import { AUTOMATION_EVENT_MAP } from './events.js';
import { AUTOMATION_FACT_MAP } from './facts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionParams(action: unknown): Record<string, unknown> {
  if (!isRecord(action)) return {};
  const params = action.params ?? action.payload;
  return isRecord(params) ? params : {};
}

/*
 * 錯誤訊息會原樣顯示給管理員（API 回 400，編輯頁 alert），所以一律中文，
 * 寫「第幾個條件／動作」並用契約的中文名稱；契約完全沒有的欄位或動作（例如舊規則的 auto_assign）
 * 只有原始代碼，另外說明「不是系統提供的」，管理員才知道要刪除。
 */

function eventLabel(eventName: string): string {
  return AUTOMATION_EVENT_MAP.get(eventName)?.label ?? eventName;
}

function factLabel(fact: string): string {
  return AUTOMATION_FACT_MAP.get(fact)?.label ?? fact;
}

function operatorLabel(operator: string): string {
  return AUTOMATION_OPERATOR_MAP.get(operator as AutomationOperator)?.label ?? operator;
}

function actionLabel(type: string): string {
  return AUTOMATION_ACTION_MAP.get(type)?.label ?? type;
}

/** 條件依畫面上的順序（深度優先）編號，巢狀群組裡的條件也連續計數 */
function validateConditionNode(
  node: unknown,
  eventName: string,
  counter: { leaf: number },
  errors: string[],
  options: ComposeAutomationContractOptions,
): void {
  if (!isRecord(node)) {
    errors.push('條件格式錯誤');
    return;
  }

  if ('all' in node || 'any' in node) {
    const key = 'all' in node ? 'all' : 'any';
    const children = node[key];
    if (!Array.isArray(children)) {
      errors.push('條件群組格式錯誤');
      return;
    }

    children.forEach((child) => {
      validateConditionNode(child, eventName, counter, errors, options);
    });
    return;
  }

  counter.leaf += 1;
  const position = `第 ${counter.leaf} 個條件`;
  const fact = node['fact'];
  const operator = node['operator'];

  if (typeof fact !== 'string') {
    errors.push(`${position}沒有選擇欄位`);
    return;
  }

  if (typeof operator !== 'string') {
    errors.push(`${position}「${factLabel(fact)}」沒有選擇比較方式`);
    return;
  }

  if (!AUTOMATION_FACT_MAP.has(fact)) {
    errors.push(`${position}的欄位「${fact}」不是系統提供的欄位，請刪除`);
    return;
  }

  const factDef = getAutomationFactForEvent(eventName, fact, options);
  if (!factDef) {
    errors.push(`${position}的欄位「${factLabel(fact)}」不適用於「${eventLabel(eventName)}」觸發`);
    return;
  }

  if (!factDef.operators.includes(operator as AutomationOperator)) {
    errors.push(`${position}「${factDef.label}」不能使用「${operatorLabel(operator)}」比較`);
    return;
  }

  const operatorDef = AUTOMATION_OPERATOR_MAP.get(operator as AutomationOperator);
  if (operatorDef?.requiresValue && !('value' in node)) {
    errors.push(`${position}「${factDef.label}」使用「${operatorDef.label}」時必須填寫值`);
  }
}

function validateAction(
  action: unknown,
  eventName: string,
  index: number,
  errors: string[],
  options: ComposeAutomationContractOptions,
): void {
  const position = `第 ${index + 1} 個動作`;
  if (!isRecord(action)) {
    errors.push(`${position}格式錯誤`);
    return;
  }

  const type = action.type;
  if (typeof type !== 'string') {
    errors.push(`${position}沒有選擇動作類型`);
    return;
  }

  if (!AUTOMATION_ACTION_MAP.has(type)) {
    errors.push(`${position}「${type}」不是系統提供的動作，請刪除`);
    return;
  }

  const actionDef = getAutomationActionForEvent(eventName, type, options);
  if (!actionDef) {
    errors.push(`${position}「${actionLabel(type)}」不適用於「${eventLabel(eventName)}」觸發`);
    return;
  }

  validateActionParams(actionDef, actionParams(action), position, errors);
}

function validateActionParams(
  actionDef: AutomationActionDefinition,
  params: Record<string, unknown>,
  position: string,
  errors: string[],
): void {
  for (const param of actionDef.params ?? []) {
    if (!param.required) continue;
    const value = params[param.key];
    if (value === undefined || value === null || value === '') {
      errors.push(`${position}「${actionDef.label}」必須填寫「${param.label}」`);
    }
  }
}

export function validateAutomationRuleContract(input: {
  eventName: string;
  conditions: unknown;
  actions?: unknown;
  options?: ComposeAutomationContractOptions;
}): AutomationContractValidationResult {
  const errors: string[] = [];
  const options = input.options ?? {};
  const contract = composeAutomationContract(input.eventName, options);

  if (!contract) {
    return { valid: false, errors: [`未知的觸發事件「${input.eventName}」`] };
  }

  validateConditionNode(input.conditions, input.eventName, { leaf: 0 }, errors, options);

  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions)) {
      errors.push('動作格式錯誤');
    } else {
      input.actions.forEach((action, index) => {
        validateAction(action, input.eventName, index, errors, options);
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
