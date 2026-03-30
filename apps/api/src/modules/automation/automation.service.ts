/**
 * Automation service – CRUD operations + rule evaluation orchestration.
 *
 * This is the primary entry point for automation logic. Routes and the
 * event-bus worker both call into this service.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import type { TopLevelCondition } from 'json-rules-engine';
import { evaluateRules } from './engine/rule-engine.js';
import type { AutomationRuleInput, ActionDefinition } from './engine/rule-engine.js';
import { buildFacts } from './engine/fact-builder.js';
import type { FactContext } from './engine/fact-builder.js';
import { executeActions } from './engine/action-executor.js';
import type { ActionPayload } from './engine/action-executor.js';
import { AppError } from '../../shared/utils/response.js';

// ── CRUD ────────────────────────────────────────────────────────────────────

export interface RuleFilters {
  isActive?: boolean;
  trigger?: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export async function listRules(
  prisma: PrismaClient,
  tenantId: string,
  filters: RuleFilters,
  pagination: PaginationParams,
) {
  const where: Prisma.AutomationRuleWhereInput = { tenantId };

  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive;
  }

  if (filters.trigger) {
    // Match rules whose trigger JSON contains the specified type.
    // Prisma supports JSON filtering on PostgreSQL via path queries.
    where.trigger = {
      path: ['type'],
      equals: filters.trigger,
    };
  }

  const [rules, total] = await Promise.all([
    prisma.automationRule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.automationRule.count({ where }),
  ]);

  return { rules, total };
}

export async function getRule(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const rule = await prisma.automationRule.findFirst({
    where: { id, tenantId },
    include: {
      logs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!rule) {
    throw new AppError('Automation rule not found', 'NOT_FOUND', 404);
  }

  return rule;
}

export async function createRule(
  prisma: PrismaClient,
  tenantId: string,
  data: {
    name: string;
    description?: string;
    priority?: number;
    stopOnMatch?: boolean;
    trigger: Record<string, unknown>;
    conditions: Record<string, unknown>;
    actions: Array<Record<string, unknown>>;
  },
) {
  const eventType = String(data.trigger.type ?? '');
  const rule = await prisma.automationRule.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description,
      enabled: true,
      priority: data.priority ?? 0,
      eventType,
      scopeType: 'TENANT',
      stopProcessing: data.stopOnMatch ?? false,
      stopOnMatch: data.stopOnMatch ?? false,
      trigger: data.trigger as any,
      conditionsJson: data.conditions as any,
      conditions: data.conditions as any,
      actionsJson: data.actions as any,
      actions: data.actions as any,
      isActive: true,
    },
  });

  return rule;
}

export async function updateRule(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  data: {
    name?: string;
    description?: string;
    priority?: number;
    stopOnMatch?: boolean;
    isActive?: boolean;
    trigger?: Record<string, unknown>;
    conditions?: Record<string, unknown>;
    actions?: Array<Record<string, unknown>>;
  },
) {
  const existing = await prisma.automationRule.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new AppError('Automation rule not found', 'NOT_FOUND', 404);
  }

  const updateData: Prisma.AutomationRuleUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.stopOnMatch !== undefined) {
    updateData.stopOnMatch = data.stopOnMatch;
    updateData.stopProcessing = data.stopOnMatch;
  }
  if (data.isActive !== undefined) {
    updateData.isActive = data.isActive;
    updateData.enabled = data.isActive;
  }
  if (data.trigger !== undefined) {
    updateData.trigger = data.trigger as any;
    updateData.eventType = String(data.trigger.type ?? '');
  }
  if (data.conditions !== undefined) {
    updateData.conditions = data.conditions as any;
    updateData.conditionsJson = data.conditions as any;
  }
  if (data.actions !== undefined) {
    updateData.actions = data.actions as any;
    updateData.actionsJson = data.actions as any;
  }

  const rule = await prisma.automationRule.update({
    where: { id },
    data: updateData,
  });

  return rule;
}

export async function deleteRule(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const existing = await prisma.automationRule.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new AppError('Automation rule not found', 'NOT_FOUND', 404);
  }

  // Soft delete – deactivate instead of hard delete
  const rule = await prisma.automationRule.update({
    where: { id },
    data: { isActive: false },
  });

  return rule;
}

// ── Test (dry run) ──────────────────────────────────────────────────────────

export async function testRule(
  prisma: PrismaClient,
  tenantId: string,
  ruleId: string,
  testFacts?: Record<string, unknown>,
) {
  const rule = await prisma.automationRule.findFirst({
    where: { id: ruleId, tenantId },
  });

  if (!rule) {
    throw new AppError('Automation rule not found', 'NOT_FOUND', 404);
  }

  const conditions = rule.conditions as unknown as TopLevelCondition;
  const actions = rule.actions as unknown as ActionDefinition[];

  const ruleInput: AutomationRuleInput = {
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    conditions,
    actions,
  };

  // Use provided test facts or empty object
  const facts = testFacts ?? {};

  const matchedRules = await evaluateRules([ruleInput], facts);
  const matched = matchedRules.length > 0;

  return {
    matched,
    rule: {
      id: rule.id,
      name: rule.name,
      conditions: rule.conditions,
      actions: rule.actions,
    },
    facts,
    matchedRules,
  };
}

// ── Trigger Automation ──────────────────────────────────────────────────────

export interface TriggerContext {
  contactId?: string;
  conversationId?: string;
  messageContent?: string;
  caseId?: string;
  activityId?: string;
  shortLinkId?: string;
}

export interface TriggerResult {
  totalRulesEvaluated: number;
  matchedRules: number;
  results: Array<{
    ruleId: string;
    ruleName: string;
    matched: boolean;
    actions?: Array<{ action: string; success: boolean; error?: string }>;
    stoppedChain?: boolean;
  }>;
}

/**
 * Main automation trigger: evaluate all active rules for a tenant/event,
 * and execute actions for any that match.
 *
 * Steps:
 *  1. Fetch all active rules for the tenant that match the trigger event
 *  2. Build facts from context (database lookups)
 *  3. Evaluate rules using the rule engine
 *  4. Execute actions for matched rules
 *  5. Respect stopOnMatch
 *  6. Return results
 */
export async function triggerAutomation(
  prisma: PrismaClient,
  io: Server,
  tenantId: string,
  event: string,
  context: TriggerContext,
  agentId?: string,
): Promise<TriggerResult> {
  // 1. Fetch all active rules matching the trigger event type
  const allRules = await prisma.automationRule.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    orderBy: { priority: 'desc' },
  });

  // Filter rules whose trigger.type matches the event
  const matchingRules = allRules.filter((rule) => {
    const trigger = rule.trigger as Record<string, unknown>;
    return trigger?.type === event;
  });

  if (matchingRules.length === 0) {
    return { totalRulesEvaluated: 0, matchedRules: 0, results: [] };
  }

  // 2. Build facts from context
  const factContext: FactContext = {
    tenantId,
    contactId: context.contactId,
    conversationId: context.conversationId,
    messageContent: context.messageContent,
    caseId: context.caseId,
  };

  const facts = await buildFacts(prisma, factContext);

  // 3. Convert DB rules to engine input format
  const ruleInputs: AutomationRuleInput[] = matchingRules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    conditions: rule.conditions as unknown as TopLevelCondition,
    actions: rule.actions as unknown as ActionDefinition[],
  }));

  // 4. Evaluate rules
  const matched = await evaluateRules(ruleInputs, facts as Record<string, unknown>);

  // 5. Execute actions for matched rules
  const results: TriggerResult['results'] = [];

  for (const match of matched) {
    const actionPayloads: ActionPayload[] = match.actions.map((a) => ({
      type: a.type,
      params: a.params,
    }));

    const actionResults = await executeActions(
      prisma,
      io,
      actionPayloads,
      {
        tenantId,
        contactId: context.contactId,
        conversationId: context.conversationId,
      },
      match.ruleId,
      agentId,
    );

    results.push({
      ruleId: match.ruleId,
      ruleName: match.ruleName,
      matched: true,
      actions: actionResults,
      stoppedChain: match.stopOnMatch,
    });
  }

  return {
    totalRulesEvaluated: matchingRules.length,
    matchedRules: matched.length,
    results,
  };
}

// ── Logs ────────────────────────────────────────────────────────────────────

export async function listLogs(
  prisma: PrismaClient,
  tenantId: string,
  pagination: PaginationParams,
  filters?: { ruleId?: string; success?: boolean },
) {
  const where: Prisma.AutomationLogWhereInput = { tenantId };

  if (filters?.ruleId) {
    where.ruleId = filters.ruleId;
  }
  if (filters?.success !== undefined) {
    where.success = filters.success;
  }

  const [logs, total] = await Promise.all([
    prisma.automationLog.findMany({
      where,
      include: {
        rule: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.automationLog.count({ where }),
  ]);

  return { logs, total };
}
