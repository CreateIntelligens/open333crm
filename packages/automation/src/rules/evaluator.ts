import { Engine } from 'json-rules-engine';
import type { Event, TopLevelCondition } from 'json-rules-engine';
import { registerCustomOperators } from './operators.js';

export interface AutomationRuleInput {
  id: string;
  name: string;
  priority: number;
  stopOnMatch: boolean;
  conditions: TopLevelCondition;
  actions: ActionDefinition[];
}

export interface ActionDefinition {
  type: string;
  params: Record<string, unknown>;
}

export interface MatchedRule {
  ruleId: string;
  ruleName: string;
  priority: number;
  stopOnMatch: boolean;
  event: Event;
  actions: ActionDefinition[];
}

export async function evaluateRules(
  rules: AutomationRuleInput[],
  facts: Record<string, unknown>,
): Promise<MatchedRule[]> {
  if (rules.length === 0) return [];

  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
  const matchedRules: MatchedRule[] = [];

  for (const rule of sortedRules) {
    const engine = new Engine([], { allowUndefinedFacts: true });
    registerCustomOperators(engine);

    const event: Event = {
      type: 'automation-triggered',
      params: {
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        stopOnMatch: rule.stopOnMatch,
        actions: rule.actions,
      },
    };

    engine.addRule({
      name: rule.name,
      priority: rule.priority,
      conditions: rule.conditions,
      event,
    });

    const { events } = await engine.run(facts);
    if (events.length === 0) continue;

    matchedRules.push({
      ruleId: rule.id,
      ruleName: rule.name,
      priority: rule.priority,
      stopOnMatch: rule.stopOnMatch,
      event: events[0],
      actions: rule.actions,
    });

    if (rule.stopOnMatch) break;
  }

  return matchedRules;
}
