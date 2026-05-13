import type { AutomationOperator, AutomationOperatorDefinition } from './types.js';

export const AUTOMATION_OPERATORS: readonly AutomationOperatorDefinition[] = [
  { name: 'equal', label: '等於', requiresValue: true },
  { name: 'notEqual', label: '不等於', requiresValue: true },
  { name: 'greaterThan', label: '大於', requiresValue: true },
  { name: 'greaterThanInclusive', label: '大於等於', requiresValue: true },
  { name: 'lessThan', label: '小於', requiresValue: true },
  { name: 'lessThanInclusive', label: '小於等於', requiresValue: true },
  { name: 'in', label: '包含於', requiresValue: true },
  { name: 'notIn', label: '不包含於', requiresValue: true },
  { name: 'contains', label: '包含', requiresValue: true },
  { name: 'containsAny', label: '包含任一', requiresValue: true },
  { name: 'containsAll', label: '包含全部', requiresValue: true },
  { name: 'notContains', label: '不包含', requiresValue: true },
  { name: 'exists', label: '有值', requiresValue: false },
  { name: 'notExists', label: '無值', requiresValue: false },
] as const;

export const AUTOMATION_OPERATOR_MAP: ReadonlyMap<
  AutomationOperator,
  AutomationOperatorDefinition
> = new Map(AUTOMATION_OPERATORS.map((operator) => [operator.name, operator]));

export const VALUELESS_AUTOMATION_OPERATORS: ReadonlySet<AutomationOperator> =
  new Set(
    AUTOMATION_OPERATORS
      .filter((operator) => !operator.requiresValue)
      .map((operator) => operator.name),
  );

export function isAutomationOperator(value: string): value is AutomationOperator {
  return AUTOMATION_OPERATOR_MAP.has(value as AutomationOperator);
}
