import type { SlaConditionOperator } from './facts.js';
import { SLA_CONDITION_FACT_MAP, getSlaConditionFactsForEvent } from './facts.js';
import type { SlaEventName } from './events.js';
import { isSlaEventName } from './events.js';

export interface SlaRuleValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateConditionNode(
  node: unknown,
  eventName: SlaEventName,
  path: string,
  errors: string[],
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
      validateConditionNode(child, eventName, `${path}.${key}[${index}]`, errors);
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

  const allowedFacts = getSlaConditionFactsForEvent(eventName);
  const factDef = SLA_CONDITION_FACT_MAP.get(fact);
  if (!factDef || !allowedFacts.some((allowed) => allowed.key === fact)) {
    errors.push(`${path}.fact is not allowed for ${eventName}: ${fact}`);
    return;
  }

  if (!factDef.operators.includes(operator as SlaConditionOperator)) {
    errors.push(`${path}.operator is not allowed for ${fact}: ${operator}`);
  }

  if (!['exists', 'notExists'].includes(operator) && !('value' in node)) {
    errors.push(`${path}.value is required for ${operator}`);
  }
}

export function validateSlaRuleConditionTree(
  eventName: string,
  conditions: unknown,
): SlaRuleValidationResult {
  const errors: string[] = [];

  if (!isSlaEventName(eventName)) {
    return { valid: false, errors: [`Unknown SLA event: ${eventName}`] };
  }

  validateConditionNode(conditions, eventName, 'conditions', errors);
  return { valid: errors.length === 0, errors };
}

export function isSlaRuleEvent(value: string): value is SlaEventName {
  return isSlaEventName(value);
}
