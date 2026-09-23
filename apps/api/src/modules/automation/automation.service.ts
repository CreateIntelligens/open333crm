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
import { notFound } from '../../shared/messages/resource.js';

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
  // enabled=false 代表「已刪除」（見 deleteRule），列表一律不顯示。
  // 使用者手動停用的規則 isActive=false 但 enabled 仍為 true，仍會列出。
  const where: Prisma.AutomationRuleWhereInput = { tenantId, enabled: true };

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
    // enabled=false 代表已刪除：查不到才對，否則刪掉的規則仍可用網址開啟
    where: { id, tenantId, enabled: true },
    include: {
      logs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!rule) {
    throw new AppError(notFound('automationRule'), 'NOT_FOUND', 404);
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
    // enabled=false 代表已刪除：不可更新，否則帶 isActive:true 就能把它復活
    where: { id, tenantId, enabled: true },
  });

  if (!existing) {
    throw new AppError(notFound('automationRule'), 'NOT_FOUND', 404);
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
    // ⚠️ 不可連動寫 enabled：enabled 現在是「已刪除」標記（見 deleteRule），
    // 而 isActive 是使用者在列表上切換的啟用狀態。
    // 兩者連動的話，使用者一關閉規則就等同刪除——列表與 getRule 都會查不到，
    // 再也無法從任何 UI 路徑把它打開。
    updateData.isActive = data.isActive;
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
    throw new AppError(notFound('automationRule'), 'NOT_FOUND', 404);
  }

  // 軟刪：用 enabled 標記「已刪除」，isActive 同步關掉以停止觸發。
  //
  // 為什麼不共用 isActive：畫面上的啟用切換開關寫的就是 isActive，
  // 使用者「手動停用」與「刪除」若共用同一個欄位，列表就無法區分——
  // 這正是先前 UAT 累積 119 筆已刪規則仍顯示在畫面上的原因（CM-170）。
  // enabled 欄位原本幾乎沒被使用（worker 的觸發判斷只看 isActive），
  // 挪用為刪除標記不影響既有行為。
  const rule = await prisma.automationRule.update({
    where: { id },
    data: { enabled: false, isActive: false },
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
    // 已刪除的規則不該還能 dry-run
    where: { id: ruleId, tenantId, enabled: true },
  });

  if (!rule) {
    throw new AppError(notFound('automationRule'), 'NOT_FOUND', 404);
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
