import {
  AUTOMATION_ACTION_DEFINITIONS,
  AUTOMATION_ACTION_MAP,
} from './actions.js';
import { AUTOMATION_EVENT_MAP } from './events.js';
import { AUTOMATION_FACT_DEFINITIONS, AUTOMATION_FACT_MAP } from './facts.js';
import { AUTOMATION_OPERATORS } from './operators.js';
import type {
  AutomationActionDefinition,
  AutomationFactDefinition,
  AutomationScope,
  ComposeAutomationContractOptions,
  ComposedAutomationContract,
} from './types.js';

function hasAllScopes(
  availableScopes: ReadonlySet<AutomationScope>,
  requiredScopes: readonly AutomationScope[],
): boolean {
  return requiredScopes.every((scope) => availableScopes.has(scope));
}

function getAvailableScopes(
  eventProvides: readonly AutomationScope[],
  eventResolvable: readonly AutomationScope[] | undefined,
  enabledResolvers: readonly AutomationScope[] | undefined,
): AutomationScope[] {
  const scopes = new Set<AutomationScope>(eventProvides);
  const resolvable = new Set(eventResolvable ?? []);

  for (const scope of enabledResolvers ?? []) {
    if (resolvable.has(scope)) {
      scopes.add(scope);
    }
  }

  return [...scopes];
}

export function composeAutomationContract(
  eventName: string,
  options: ComposeAutomationContractOptions = {},
): ComposedAutomationContract | null {
  const event = AUTOMATION_EVENT_MAP.get(eventName);
  if (!event) return null;

  const scopes = getAvailableScopes(
    event.provides,
    event.resolvable,
    options.enabledResolvers,
  );
  const availableScopes = new Set(scopes);

  const facts = AUTOMATION_FACT_DEFINITIONS.filter((fact) => {
    if (!hasAllScopes(availableScopes, fact.requires)) return false;
    return !fact.events || fact.events.includes(event.name);
  });

  const actions = AUTOMATION_ACTION_DEFINITIONS.filter((action) =>
    hasAllScopes(availableScopes, action.requires),
  );

  return {
    event,
    scopes,
    facts,
    actions,
    operators: AUTOMATION_OPERATORS,
  };
}

export function getAutomationFactForEvent(
  eventName: string,
  factKey: string,
  options: ComposeAutomationContractOptions = {},
): AutomationFactDefinition | undefined {
  return composeAutomationContract(eventName, options)?.facts.find(
    (fact) => fact.key === factKey,
  );
}

export function getAutomationActionForEvent(
  eventName: string,
  actionType: string,
  options: ComposeAutomationContractOptions = {},
): AutomationActionDefinition | undefined {
  return composeAutomationContract(eventName, options)?.actions.find(
    (action) => action.type === actionType,
  );
}

export function getAutomationFactDefinition(
  factKey: string,
): AutomationFactDefinition | undefined {
  return AUTOMATION_FACT_MAP.get(factKey);
}

export function getAutomationActionDefinition(
  actionType: string,
): AutomationActionDefinition | undefined {
  return AUTOMATION_ACTION_MAP.get(actionType);
}
