import {
  AutomationRule,
  EventType,
  AutomationAction,
  ScopeType,
} from "../types.js";

const inMemoryRules: Map<string, AutomationRule> = new Map();

export class RuleService {
  async createRule(data: {
    name: string;
    description?: string;
    eventType: EventType;
    priority?: number;
    stopProcessing?: boolean;
    scopeType: ScopeType;
    scopeId?: string;
    conditionsJson: unknown;
    actionsJson: AutomationAction[];
    tenantId: string;
  }): Promise<AutomationRule> {
    const rule: AutomationRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: data.name,
      description: data.description,
      enabled: true,
      eventType: data.eventType,
      priority: data.priority ?? 0,
      stopProcessing: data.stopProcessing ?? false,
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      conditionsJson: data.conditionsJson,
      actionsJson: data.actionsJson,
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: data.tenantId,
    };
    inMemoryRules.set(rule.id, rule);
    return rule;
  }

  async getRule(id: string, _tenantId: string): Promise<AutomationRule | null> {
    return inMemoryRules.get(id) ?? null;
  }

  async listRules(
    tenantId: string,
    filters?: {
      eventType?: EventType;
      scopeType?: ScopeType;
      enabled?: boolean;
    },
  ): Promise<AutomationRule[]> {
    let rules = Array.from(inMemoryRules.values()).filter(
      (r) => r.tenantId === tenantId,
    );

    if (filters?.eventType) {
      rules = rules.filter((r) => r.eventType === filters.eventType);
    }
    if (filters?.scopeType) {
      rules = rules.filter((r) => r.scopeType === filters.scopeType);
    }
    if (filters?.enabled !== undefined) {
      rules = rules.filter((r) => r.enabled === filters.enabled);
    }

    return rules.sort((a, b) => b.priority - a.priority);
  }

  async getRulesForEvent(
    eventType: EventType,
    tenantId: string,
  ): Promise<AutomationRule[]> {
    return this.listRules(tenantId, { eventType, enabled: true });
  }

  async updateRule(
    id: string,
    tenantId: string,
    data: Partial<{
      name: string;
      description: string;
      enabled: boolean;
      priority: number;
      stopProcessing: boolean;
      conditionsJson: unknown;
      actionsJson: AutomationAction[];
    }>,
  ): Promise<AutomationRule | null> {
    const rule = inMemoryRules.get(id);
    if (!rule || rule.tenantId !== tenantId) return null;

    const updated: AutomationRule = {
      ...rule,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.stopProcessing !== undefined && {
        stopProcessing: data.stopProcessing,
      }),
      ...(data.conditionsJson !== undefined && {
        conditionsJson: data.conditionsJson,
      }),
      ...(data.actionsJson !== undefined && { actionsJson: data.actionsJson }),
      updatedAt: new Date(),
    };

    inMemoryRules.set(id, updated);
    return updated;
  }

  async deleteRule(id: string, tenantId: string): Promise<boolean> {
    const rule = inMemoryRules.get(id);
    if (!rule || rule.tenantId !== tenantId) return false;
    return inMemoryRules.delete(id);
  }

  async toggleRule(
    id: string,
    tenantId: string,
    enabled: boolean,
  ): Promise<AutomationRule | null> {
    return this.updateRule(id, tenantId, { enabled });
  }
}

export const ruleService = new RuleService();
