import { AutomationEngine } from "../engine.js";
import { buildFact, CRMEvent } from "../fact-builder/index.js";
import { ruleService } from "../services/rule-service.js";
import { executionService } from "../services/execution-service.js";
import { AutomationFact, ExecutionStatus } from "../types.js";

export class Dispatcher {
  private engine: AutomationEngine;

  constructor() {
    this.engine = new AutomationEngine();
  }

  async dispatch(
    event: CRMEvent,
    tenantId: string,
  ): Promise<{
    executionId: string;
    matchedRules: string[];
    actionsExecuted: number;
    status: ExecutionStatus;
  }> {
    const fact = await buildFact(event);

    const execution = await executionService.createExecution({
      eventType: event.type,
      eventId: "id" in event ? event.id : undefined,
      factSnapshot: fact,
      candidateRuleIds: [],
      tenantId,
    });

    const rules = await ruleService.getRulesForEvent(event.type, tenantId);

    const result = await this.engine.evaluateAndExecute(fact, rules, {
      tenantId,
      executionId: execution.id,
    });

    const matchedRuleIds = result.results.map((r) => r.rule.id);
    const actionsCount = result.results.reduce(
      (sum, r) => sum + r.actions.length,
      0,
    );

    let status: ExecutionStatus = "SUCCESS";
    const hasFailedActions = result.results.some((r) =>
      r.actions.some((a) => a.status === "FAILED"),
    );

    if (hasFailedActions) {
      status = result.results.some((r) =>
        r.actions.some(
          (a) =>
            a.status === "FAILED" &&
            !r.rule.actionsJson.find((a: any) => a.continueOnError),
        ),
      )
        ? "FAILED"
        : "PARTIAL";
    } else if (result.results.length === 0) {
      status = "SUCCESS";
    }

    await executionService.updateExecution(execution.id, {
      matchedRuleIds,
      actionsExecuted: result.results.flatMap((r) => r.actions),
      stoppedAt: result.stoppedAt,
      status,
    });

    return {
      executionId: execution.id,
      matchedRules: matchedRuleIds,
      actionsExecuted: actionsCount,
      status,
    };
  }

  async dispatchManual(
    eventType: string,
    fact: AutomationFact,
    tenantId: string,
  ): Promise<{
    executionId: string;
    matchedRules: string[];
    actionsExecuted: number;
    status: ExecutionStatus;
  }> {
    const execution = await executionService.createExecution({
      eventType,
      factSnapshot: fact,
      candidateRuleIds: [],
      tenantId,
    });

    const rules = await ruleService.getRulesForEvent(
      eventType as any,
      tenantId,
    );

    const result = await this.engine.evaluateAndExecute(fact, rules, {
      tenantId,
      executionId: execution.id,
    });

    const matchedRuleIds = result.results.map((r) => r.rule.id);
    const actionsCount = result.results.reduce(
      (sum, r) => sum + r.actions.length,
      0,
    );

    let status: ExecutionStatus = result.success ? "SUCCESS" : "FAILED";
    if (
      result.results.some((r) => r.actions.some((a) => a.status === "FAILED"))
    ) {
      status = "PARTIAL";
    }

    await executionService.updateExecution(execution.id, {
      matchedRuleIds,
      actionsExecuted: result.results.flatMap((r) => r.actions),
      stoppedAt: result.stoppedAt,
      status,
    });

    return {
      executionId: execution.id,
      matchedRules: matchedRuleIds,
      actionsExecuted: actionsCount,
      status,
    };
  }
}

export const dispatcher = new Dispatcher();
