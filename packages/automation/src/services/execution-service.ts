import {
  AutomationExecution,
  AutomationFact,
  ActionExecutionResult,
  ExecutionStatus,
} from "../types.js";

const inMemoryExecutions: Map<string, AutomationExecution> = new Map();
let executionCounter = 0;

export class ExecutionService {
  async createExecution(data: {
    eventType: string;
    eventId?: string;
    factSnapshot: AutomationFact;
    candidateRuleIds: string[];
    tenantId: string;
  }): Promise<AutomationExecution> {
    const execution: AutomationExecution = {
      id: `exec-${++executionCounter}-${Date.now()}`,
      eventType: data.eventType,
      eventId: data.eventId,
      factSnapshot: data.factSnapshot,
      candidateRuleIds: data.candidateRuleIds,
      matchedRuleIds: [],
      actionsExecuted: [],
      status: "SUCCESS",
      createdAt: new Date(),
      tenantId: data.tenantId,
    };
    inMemoryExecutions.set(execution.id, execution);
    return execution;
  }

  async updateExecution(
    id: string,
    data: {
      matchedRuleIds?: string[];
      actionsExecuted?: ActionExecutionResult[];
      stoppedAt?: string;
      status?: ExecutionStatus;
    },
  ): Promise<AutomationExecution | null> {
    const execution = inMemoryExecutions.get(id);
    if (!execution) return null;

    const updated: AutomationExecution = {
      ...execution,
      ...(data.matchedRuleIds !== undefined && {
        matchedRuleIds: data.matchedRuleIds,
      }),
      ...(data.actionsExecuted !== undefined && {
        actionsExecuted: data.actionsExecuted,
      }),
      ...(data.stoppedAt !== undefined && { stoppedAt: data.stoppedAt }),
      ...(data.status !== undefined && { status: data.status }),
    };

    inMemoryExecutions.set(id, updated);
    return updated;
  }

  async getExecution(id: string): Promise<AutomationExecution | null> {
    return inMemoryExecutions.get(id) ?? null;
  }

  async listExecutions(
    tenantId: string,
    _options?: {
      limit?: number;
      offset?: number;
      eventType?: string;
      status?: ExecutionStatus;
    },
  ): Promise<{ executions: AutomationExecution[]; total: number }> {
    const executions = Array.from(inMemoryExecutions.values())
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      executions,
      total: executions.length,
    };
  }

  async recordActionResult(
    _executionId: string,
    _actionType: string,
    _params: unknown,
    _status: "SUCCESS" | "FAILED" | "ROLLED_BACK",
    _result?: unknown,
    _errorMessage?: string,
    _beforeSnapshot?: unknown,
    _afterSnapshot?: unknown,
    _rollbackable?: boolean,
  ): Promise<void> {
    // Stub - can be expanded when database is connected
  }

  async rollbackActionResult(_id: string): Promise<boolean> {
    return false;
  }

  async getActionResults(_executionId: string): Promise<unknown[]> {
    return [];
  }
}

export const executionService = new ExecutionService();
