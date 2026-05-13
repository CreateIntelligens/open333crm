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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function actionParams(action: unknown): Record<string, unknown> {
  if (!isRecord(action)) return {};
  const params = action.params ?? action.payload;
  return isRecord(params) ? params : {};
}

function validateConditionNode(
  node: unknown,
  eventName: string,
  path: string,
  errors: string[],
  options: ComposeAutomationContractOptions,
): void {
  if (!isRecord(node)) {
    errors.push(`${path} must be an object`);
    return;
  }

  if ('all' in node || 'any' in node) {
    const key = 'all' in node ? 'all' : 'any';
    const children = node[key];
    if (!Array.isArray(children)) {
      errors.push(`${path}.${key} must be an array`);
      return;
    }

    children.forEach((child, index) => {
      validateConditionNode(child, eventName, `${path}.${key}[${index}]`, errors, options);
    });
    return;
  }

  const fact = node['fact'];
  const operator = node['operator'];

  if (typeof fact !== 'string') {
    errors.push(`${path}.fact must be a string`);
    return;
  }

  if (typeof operator !== 'string') {
    errors.push(`${path}.operator must be a string`);
    return;
  }

  const factDef = getAutomationFactForEvent(eventName, fact, options);
  if (!factDef) {
    errors.push(`${path}.fact is not allowed for ${eventName}: ${fact}`);
    return;
  }

  if (!factDef.operators.includes(operator as AutomationOperator)) {
    errors.push(`${path}.operator is not allowed for ${fact}: ${operator}`);
    return;
  }

  const operatorDef = AUTOMATION_OPERATOR_MAP.get(operator as AutomationOperator);
  if (operatorDef?.requiresValue && !('value' in node)) {
    errors.push(`${path}.value is required for ${operator}`);
  }
}

function validateAction(
  action: unknown,
  eventName: string,
  index: number,
  errors: string[],
  options: ComposeAutomationContractOptions,
): void {
  if (!isRecord(action)) {
    errors.push(`actions[${index}] must be an object`);
    return;
  }

  const type = action.type;
  if (typeof type !== 'string') {
    errors.push(`actions[${index}].type must be a string`);
    return;
  }

  const actionDef = getAutomationActionForEvent(eventName, type, options);
  if (!actionDef) {
    errors.push(`actions[${index}].type is not allowed for ${eventName}: ${type}`);
    return;
  }

  validateActionParams(actionDef, actionParams(action), index, errors);
}

function validateActionParams(
  actionDef: AutomationActionDefinition,
  params: Record<string, unknown>,
  index: number,
  errors: string[],
): void {
  for (const param of actionDef.params ?? []) {
    if (!param.required) continue;
    const value = params[param.key];
    if (value === undefined || value === null || value === '') {
      errors.push(`actions[${index}].${param.key} is required for ${actionDef.type}`);
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
    return { valid: false, errors: [`Unknown automation event: ${input.eventName}`] };
  }

  validateConditionNode(input.conditions, input.eventName, 'conditions', errors, options);

  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions)) {
      errors.push('actions must be an array');
    } else {
      input.actions.forEach((action, index) => {
        validateAction(action, input.eventName, index, errors, options);
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
