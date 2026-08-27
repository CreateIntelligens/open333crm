/**
 * Automation service – CRUD operations and explicit rule testing.
 *
 * Runtime automation execution is owned by apps/workers.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import type { TopLevelCondition } from 'json-rules-engine';
import { evaluateRules } from './engine/rule-engine.js';
import type { AutomationRuleInput, ActionDefinition } from './engine/rule-engine.js';
import { AppError } from '../../shared/utils/response.js';
import { validateAutomationRuleContract } from '@open333crm/automation';

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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  validateRuleContract(eventType, data.conditions, data.actions);

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
      conditions: data.conditions as any,
      actions: data.actions as any,
      isActive: true,
    },
  });

  return rule;
}

export async function updateRule(
  prisma: TenantDb,
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

  const existingTrigger = existing.trigger as Record<string, unknown>;
  const nextEventType = String(
    data.trigger?.type ?? existingTrigger?.type ?? existing.eventType ?? '',
  );
  const nextConditions = data.conditions ?? (existing.conditions as Record<string, unknown>);
  const nextActions = data.actions ?? (existing.actions as Array<Record<string, unknown>>);
  validateRuleContract(nextEventType, nextConditions, nextActions);

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
  }
  if (data.actions !== undefined) {
    updateData.actions = data.actions as any;
  }

  const rule = await prisma.automationRule.update({
    where: { id },
    data: updateData,
  });

  return rule;
}

function validateRuleContract(
  eventType: string,
  conditions: unknown,
  actions: unknown,
): void {
  const result = validateAutomationRuleContract({
    eventName: eventType,
    conditions,
    actions,
  });
  if (!result.valid) {
    throw new AppError(
      `Invalid automation rule contract: ${result.errors.join('; ')}`,
      'VALIDATION_ERROR',
      400,
    );
  }
}

export async function deleteRule(
  prisma: TenantDb,
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
  prisma: TenantDb,
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
  validateRuleContract(rule.eventType, conditions, actions);

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

// ── Logs ────────────────────────────────────────────────────────────────────

export async function listLogs(
  prisma: TenantDb,
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
