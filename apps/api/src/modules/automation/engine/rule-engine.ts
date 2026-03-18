/**
 * Core automation rule engine wrapper around json-rules-engine.
 *
 * Responsibilities:
 *  - Create an Engine per evaluation run (stateless per call)
 *  - Register custom operators
 *  - Sort rules by priority DESC
 *  - Support stopOnMatch semantics
 *  - Return matched rules with event data
 */

import { Engine } from 'json-rules-engine';
import type { TopLevelCondition, Event } from 'json-rules-engine';
import { customOperators } from './operators/index.js';

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

/**
 * Evaluate a list of automation rules against a set of facts.
 *
 * Rules are sorted by priority DESC (highest first). If a matched rule has
 * `stopOnMatch = true`, no further rules are evaluated.
 *
 * @returns Array of matched rules with their event/action data.
 */
export async function evaluateRules(
  rules: AutomationRuleInput[],
  facts: Record<string, unknown>,
): Promise<MatchedRule[]> {
  if (rules.length === 0) return [];

  // Sort rules by priority descending (highest priority first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  const matchedRules: MatchedRule[] = [];

  for (const rule of sortedRules) {
    const engine = new Engine([], { allowUndefinedFacts: true });

    // Register all custom operators
    for (const op of customOperators) {
      engine.addOperator(op.name, op.callback);
    }

    // Build the event that will be emitted on success.
    // We embed the rule metadata + actions in event.params so we can
    // retrieve them after the engine run completes.
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

    if (events.length > 0) {
      const matchedEvent = events[0];
      matchedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
        stopOnMatch: rule.stopOnMatch,
        event: matchedEvent,
        actions: rule.actions,
      });

      // If this matched rule has stopOnMatch, stop evaluating
      if (rule.stopOnMatch) {
        break;
      }
    }
  }

  return matchedRules;
}
