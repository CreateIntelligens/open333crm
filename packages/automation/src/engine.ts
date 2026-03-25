import { Engine, Rule, RuleResult, RuleProperties } from "json-rules-engine";
import {
  AutomationFact,
  AutomationRule,
  AutomationAction,
  ActionExecutionResult,
  EventType,
} from "./types.js";
import { actionRegistry } from "./action-registry/index.js";

export interface EvaluationResult {
  success: boolean;
  results: {
    rule: AutomationRule;
    actions: ActionExecutionResult[];
  }[];
  stoppedAt?: string;
  error?: string;
}

export class AutomationEngine {
  private engine: Engine;

  constructor() {
    this.engine = new Engine();
  }

  public addRule(rule: AutomationRule) {
    const jsonRule: RuleProperties = {
      name: rule.id,
      priority: rule.priority,
      conditions: this.buildConditions(rule.conditionsJson),
      event: { type: "action" },
    };
    this.engine.addRule(jsonRule);
  }

  private buildConditions(conditionsJson: unknown): any {
    if (!conditionsJson) {
      return { all: [] };
    }

    const conditions = conditionsJson as { any?: unknown[]; all?: unknown[] };
    const conditionList = conditions.any || conditions.all || [];

    return {
      all: conditionList.map((cond: unknown) => {
        const c = cond as { fact: string; operator: string; value: unknown };
        return {
          fact: c.fact,
          operator: c.operator,
          value: c.value,
        };
      }),
    };
  }

  public clearRules() {
    this.engine = new Engine();
  }

  public async evaluate(
    fact: AutomationFact,
  ): Promise<{ results: RuleResult[] }> {
    const result = await this.engine.run(fact);
    return { results: result.results };
  }

  public async evaluateAndExecute(
    fact: AutomationFact,
    rules: AutomationRule[],
    context: { tenantId: string; executionId: string },
  ): Promise<EvaluationResult> {
    this.clearRules();

    const sortedRules = [...rules]
      .filter(
        (r) => r.enabled && r.eventType === (fact.event.type as EventType),
      )
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      this.addRule(rule);
    }

    const results: EvaluationResult = {
      success: true,
      results: [],
    };

    try {
      const evaluationResult = await this.engine.run(fact);
      const ruleResults = evaluationResult.results;

      if (ruleResults.length === 0) {
        return results;
      }

      for (const result of ruleResults) {
        const matchedRule = sortedRules.find((r) => r.id === result.name);
        if (!matchedRule) continue;

        const actions = matchedRule.actionsJson as AutomationAction[];
        const actionResults: ActionExecutionResult[] = [];

        for (const action of actions) {
          try {
            const execResult = await actionRegistry.executeAction(
              action.type,
              action.params as any,
              fact,
              {
                tenantId: context.tenantId,
                executionId: context.executionId,
                ruleId: matchedRule.id,
              },
            );

            actionResults.push({
              actionType: action.type,
              ruleId: matchedRule.id,
              status: "SUCCESS",
              result: execResult.result,
              rollbackable: execResult.rollbackable,
              rollbackData: execResult.rollbackData,
            });
          } catch (error) {
            actionResults.push({
              actionType: action.type,
              ruleId: matchedRule.id,
              status: action.continueOnError ? "SKIPPED" : "FAILED",
              error: error instanceof Error ? error.message : "Unknown error",
              rollbackable: false,
            });

            if (!action.continueOnError) {
              if (matchedRule.stopProcessing) {
                results.stoppedAt = matchedRule.id;
                break;
              }
              break;
            }
          }
        }

        results.results.push({
          rule: matchedRule,
          actions: actionResults,
        });

        if (matchedRule.stopProcessing) {
          results.stoppedAt = matchedRule.id;
          break;
        }
      }
    } catch (error) {
      results.success = false;
      results.error = error instanceof Error ? error.message : "Unknown error";
    }

    return results;
  }
}
