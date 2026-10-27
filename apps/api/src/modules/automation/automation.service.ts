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
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 「傳送素材」動作要指向同租戶、啟用中的素材。契約只檢查 materialId 非空，
 * 非 UUID 或不存在的素材都能存，規則建起來卻永遠發不出訊息（UAT E2E CM-W6-04）。
 */
async function assertSendMaterialReferences(
  prisma: TenantDb,
  tenantId: string,
  actions: Array<Record<string, unknown>>,
): Promise<void> {
  const ids = actions
    .filter((a) => a.type === 'send_material')
    .map((a) => (a.params as { materialId?: unknown } | undefined)?.materialId);
  if (ids.length === 0) return;

  // 用 some 而不是 find：find 找到的元素本身是 undefined 時會被當成「沒找到」
  if (ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
    throw new AppError('傳送素材的素材 ID 格式不正確', 'VALIDATION_ERROR', 400, {
      issues: [{ path: 'actions', message: '傳送素材的素材 ID 格式不正確' }],
    });
  }
  const unique = [...new Set(ids as string[])];
  const found = await prisma.material.findMany({
    where: { tenantId, isActive: true, id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw new AppError('找不到要傳送的素材，或素材已停用', 'VALIDATION_ERROR', 400, {
      issues: [{ path: 'actions', message: '找不到要傳送的素材，或素材已停用' }],
    });
  }
}

/**
 * 「發送優惠券」的 couponId 要是同租戶、進行中的券（add-coupon-system design D25）。
 * 原本是文字框、存檔不檢查，貼錯或其他租戶的券都能存，規則觸發時才發不出去。
 * 關鍵字回覆頁、加好友禮頁與 API 都經過這裡。
 *
 * 只檢查新增或更換的券（2026-10-22 審查決定）：規則原本就指向的券之後被暫停或結束時，
 * 商家仍要能改關鍵字或素材；workers 觸發時會留下「券不是進行中」的紀錄。
 */
async function assertIssueCouponReferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: { coupon: { findMany(args: any): PromiseLike<Array<{ id: string }>> } },
  tenantId: string,
  actions: Array<Record<string, unknown>>,
  previousActions: unknown = [],
): Promise<void> {
  const couponIdsOf = (list: unknown) =>
    (Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [])
      .filter((a) => a?.type === 'issue_coupon')
      .map((a) => (a.params as { couponId?: unknown } | undefined)?.couponId);
  const unchanged = new Set(couponIdsOf(previousActions).filter((id): id is string => typeof id === 'string'));
  const ids = couponIdsOf(actions).filter((id) => !(typeof id === 'string' && unchanged.has(id)));
  if (ids.length === 0) return;

  const message = '找不到可發放的優惠券：發送優惠券要選同一個帳號下、進行中的券';
  const invalid = () =>
    new AppError(message, 'VALIDATION_ERROR', 400, { issues: [{ path: 'actions', message }] });
  if (ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) throw invalid();
  const unique = [...new Set(ids as string[])];
  const found = await prisma.coupon.findMany({
    where: { tenantId, status: 'ACTIVE', id: { in: unique } },
    select: { id: true },
  });
  if (found.length !== unique.length) throw invalid();
}

/**
 * 加好友禮每個租戶只能有一條（design D28；使用者決定 2026-10-22：後端也擋）。
 * 「加入好友」事件且含發券動作的規則就是加好友禮；設定頁只編輯一條，另外建的同類規則也會執行，
 * 同一位顧客會拿到兩張券。只傳送訊息或素材的「加入好友」規則不受限制；已刪除（enabled=false）的不算。
 */
async function assertSingleFollowGift(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: { automationRule: { findMany(args: any): PromiseLike<Array<{ actions: unknown }>> } },
  tenantId: string,
  eventType: string,
  actions: Array<Record<string, unknown>>,
  excludeRuleId?: string,
): Promise<void> {
  const issuesCoupon = (list: unknown) => Array.isArray(list) && list.some((a) => (a as { type?: unknown })?.type === 'issue_coupon');
  if (eventType !== 'contact.followed' || !issuesCoupon(actions)) return;
  const others = await prisma.automationRule.findMany({
    where: { tenantId, enabled: true, eventType: 'contact.followed', ...(excludeRuleId ? { id: { not: excludeRuleId } } : {}) },
    select: { actions: true },
  });
  if (others.some((r) => issuesCoupon(r.actions))) {
    throw new AppError('已經有加好友禮，請到「LINE 管理 → 加好友禮」修改', 'CONFLICT', 409);
  }
}

export async function createRule(
  prisma: TenantDb,
  tenantId: string,
  data: {
    name: string;
    description?: string;
    priority?: number;
    stopOnMatch?: boolean;
    /** 沒給時預設啟用（CLI、MCP 等既有呼叫端沒有送這個欄位） */
    isActive?: boolean;
    trigger: Record<string, unknown>;
    conditions: Record<string, unknown>;
    actions: Array<Record<string, unknown>>;
  },
) {
  const eventType = String(data.trigger.type ?? '');
  validateRuleContract(eventType, data.conditions, data.actions);
  await assertSendMaterialReferences(prisma, tenantId, data.actions);
  await assertIssueCouponReferences(prisma, tenantId, data.actions);
  await assertSingleFollowGift(prisma, tenantId, eventType, data.actions);

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
      // 原本一律寫 true：新增規則頁「啟用」不勾也會建立成啟用、立刻開始執行
      isActive: data.isActive ?? true,
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

  // 只在實際改動 trigger／conditions／actions 時驗證契約（同 PR #124）。
  // 只改啟用狀態、名稱、優先序不可被既有不合規的動作卡住：契約會演進（動作可能被拿掉），
  // 舊規則可能不合新版契約，但管理員至少要能停用它
  const touchesContract = data.trigger !== undefined || data.conditions !== undefined || data.actions !== undefined;
  // 改為啟用時也要驗證：workers 會整條略過不合契約的規則，開關打開卻不會執行（問題清單 A02，
  // change fix-automation-rule-gaps）。停用不驗證，管理員永遠可以關掉舊規則
  const activates = data.isActive === true;
  if (touchesContract || activates) {
    const existingTrigger = existing.trigger as Record<string, unknown>;
    const nextEventType = String(
      data.trigger?.type ?? existingTrigger?.type ?? existing.eventType ?? '',
    );
    const nextConditions = data.conditions ?? (existing.conditions as Record<string, unknown>);
    const nextActions = data.actions ?? (existing.actions as Array<Record<string, unknown>>);
    validateRuleContract(nextEventType, nextConditions, nextActions);
    await assertSingleFollowGift(prisma, tenantId, nextEventType, nextActions, id);
    if (data.actions !== undefined) {
      await assertSendMaterialReferences(prisma, tenantId, nextActions);
      await assertIssueCouponReferences(prisma, tenantId, nextActions, existing.actions);
    }
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
      `自動化規則設定有誤：${result.errors.join('；')}`,
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
