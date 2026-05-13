import { composeAutomationContract } from './composer.js';
import { AUTOMATION_OPERATOR_MAP } from './operators.js';
import type {
  AutomationActionDefinition,
  AutomationFactDefinition,
  AutomationOperator,
  ComposeAutomationContractOptions,
} from './types.js';

export interface AutomationFieldOption {
  name: string;
  label: string;
  inputType?: string;
  valueEditorType?: string;
  values?: Array<{ name: string; label: string }>;
  operators: Array<{ name: string; label: string; requiresValue: boolean }>;
}

export interface AutomationActionOption {
  value: string;
  label: string;
  definition: AutomationActionDefinition;
}

function factInputType(fact: AutomationFactDefinition): string {
  if (fact.type === 'number') return 'number';
  if (fact.type === 'boolean') return 'checkbox';
  if (fact.type === 'datetime') return 'datetime-local';
  return 'text';
}

export function factToFieldOption(fact: AutomationFactDefinition): AutomationFieldOption {
  return {
    name: fact.key,
    label: fact.label,
    inputType: factInputType(fact),
    valueEditorType: fact.values ? 'select' : undefined,
    values: fact.values?.map((option) => ({
      name: String(option.value),
      label: option.label,
    })),
    operators: fact.operators.map((operator) => {
      const operatorDef = AUTOMATION_OPERATOR_MAP.get(operator as AutomationOperator);
      return {
        name: operator,
        label: operatorDef?.label ?? operator,
        requiresValue: operatorDef?.requiresValue ?? true,
      };
    }),
  };
}

export function getAutomationFieldOptionsForEvent(
  eventName: string,
  options?: ComposeAutomationContractOptions,
): AutomationFieldOption[] {
  return composeAutomationContract(eventName, options)?.facts.map(factToFieldOption) ?? [];
}

export function getAutomationActionOptionsForEvent(
  eventName: string,
  options?: ComposeAutomationContractOptions,
): AutomationActionOption[] {
  return (
    composeAutomationContract(eventName, options)?.actions.map((action) => ({
      value: action.type,
      label: action.label,
      definition: action,
    })) ?? []
  );
}
