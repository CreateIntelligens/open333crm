/**
 * case 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：開交易、呼叫 service、送出推播與事件、寫稽核。
 *
 * - 推播在 commit 之後送出，rollback 時丟棄；事件與資料一起寫進 outbox（case-effects.ts）。
 * - 建立工單之後的廣播歸因與自動派案，在 commit 之後各自另開一個交易，最多一次：
 *   失敗只記 log，不影響已建立的工單（與搬遷前相同）。兩者都在回應之前完成。
 * - 刪除工單的稽核與刪除一起 commit；稽核寫入失敗時整筆 rollback（主規格 tenant-audit-log）。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import type { CaseStatus, Priority } from '@open333crm/shared';
import { flowOf, inTenant, type TenantScope } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { notifyTenant } from '../../events/socket-push.js';
import { createOutboxPublisher, type EventPublisher } from '../../events/outbox-publisher.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import { trackBroadcastCase } from '../marketing/broadcast.tracking.js';
import {
  addNote,
  assignCase,
  createCase,
  createCaseFromConversation,
  deleteCase,
  escalateCase,
  getCase,
  getCaseEvents,
  getCaseStats,
  linkConversationToCase,
  listCases,
  transitionCase,
  updateCase,
} from './case.service.js';
import { autoAssignCase } from './assignment.service.js';
import {
  caseCreatedEffects,
  caseEscalatedEffects,
  caseTransitionedEffects,
  notifyCaseUpdated,
  publishCaseAssigned,
  type CaseEffectDeps,
} from './case-effects.js';

export interface CaseFlowDeps {
  prisma: PrismaClient;
  io: Server;
  /** 單元測試注入假的實作；沒有給時用 outbox */
  events?: EventPublisher;
}

function effectDeps(deps: CaseFlowDeps): CaseEffectDeps {
  return { io: deps.io, events: deps.events ?? createOutboxPublisher(deps.prisma) };
}

export const getCaseStatsFlow = flowOf(getCaseStats);
export const listCasesFlow = flowOf(listCases);
export const getCaseFlow = flowOf(getCase);
export const getCaseEventsFlow = flowOf(getCaseEvents);

interface CreateCaseInput {
  title: string;
  description?: string;
  priority?: Priority;
  category?: string;
  assigneeId?: string;
  teamId?: string;
  slaPolicyId?: string;
}

/**
 * 新工單的後續工作：commit 之後各開一個交易，做廣播歸因與自動派案（沒有指定負責人、但有團隊時）。
 * 每一項各自失敗、各自記 log（inTenant() 的 afterCommit）。
 */
function afterCaseCreated(
  scope: TenantScope,
  deps: CaseFlowDeps,
  caseRecord: { id: string; contactId: string; channelId: string; teamId: string | null },
  assigneeId: string | undefined,
): void {
  const { tenantId } = scope;
  scope.afterCommit('case broadcast attribution', () =>
    inTenant(deps.prisma, tenantId, (s) => trackBroadcastCase(s.tx, caseRecord.contactId, caseRecord.id)));

  if (assigneeId || !caseRecord.teamId) return;
  const teamId = caseRecord.teamId;
  scope.afterCommit('case auto-assign', () =>
    inTenant(deps.prisma, tenantId, async (s) => {
      const assigned = await autoAssignCase(s, caseRecord.id, teamId, caseRecord.channelId);
      if (!assigned) return;
      const { agent, updated } = assigned;
      notifyCaseUpdated(s, deps.io, updated, { source: 'auto_assign' });
      await publishCaseAssigned(s, effectDeps(deps).events, {
        caseId: caseRecord.id,
        assigneeId: agent.id,
        title: updated.title,
        source: 'auto_assign',
      });
    }));
}

export function createCaseFlow(
  deps: CaseFlowDeps,
  actor: RequestActor,
  data: CreateCaseInput & { contactId: string; channelId: string },
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const caseRecord = await createCase(scope, actor.agentId, data);
    await caseCreatedEffects(scope, effectDeps(deps), caseRecord, null);
    afterCaseCreated(scope, deps, caseRecord, data.assigneeId);
    return caseRecord;
  });
}

export function createCaseFromConversationFlow(
  deps: CaseFlowDeps,
  actor: RequestActor,
  conversationId: string,
  data: CreateCaseInput,
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const caseRecord = await createCaseFromConversation(scope, conversationId, actor.agentId, data);
    await caseCreatedEffects(scope, effectDeps(deps), caseRecord, conversationId);
    afterCaseCreated(scope, deps, caseRecord, data.assigneeId);
    return caseRecord;
  });
}

export function assignCaseFlow(deps: CaseFlowDeps, actor: RequestActor, caseId: string, assigneeId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const updated = await assignCase(scope, caseId, actor.agentId, assigneeId);
    notifyCaseUpdated(scope, deps.io, updated);
    await publishCaseAssigned(scope, effectDeps(deps).events, { caseId, assigneeId, title: updated.title });
    return updated;
  });
}

/** 結案、關閉、重啟（頂部按鈕） */
export function transitionCaseFlow(deps: CaseFlowDeps, actor: RequestActor, caseId: string, toStatus: CaseStatus) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const transition = await transitionCase(scope, caseId, actor.agentId, toStatus);
    await caseTransitionedEffects(scope, effectDeps(deps), transition);
    return transition.updated;
  });
}

export function escalateCaseFlow(
  deps: CaseFlowDeps,
  actor: RequestActor,
  caseId: string,
  body: Parameters<typeof escalateCase>[3],
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const escalation = await escalateCase(scope, caseId, actor.agentId, body);
    await caseEscalatedEffects(scope, effectDeps(deps), escalation);
    return escalation.updated;
  });
}

/** 詳情頁就地編輯。改狀態時送出和頂部按鈕相同的推播與事件 */
export function updateCaseFlow(
  deps: CaseFlowDeps,
  actor: RequestActor,
  caseId: string,
  data: Parameters<typeof updateCase>[2],
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const { result, change } = await updateCase(scope, caseId, data, { actorId: actor.agentId });
    if (change.kind === 'fields') notifyCaseUpdated(scope, deps.io, change.updated);
    else if (change.kind === 'escalated') await caseEscalatedEffects(scope, effectDeps(deps), change);
    else await caseTransitionedEffects(scope, effectDeps(deps), change);
    return result;
  });
}

export function addNoteFlow(
  deps: CaseFlowDeps,
  actor: RequestActor,
  caseId: string,
  input: { content: string; isInternal: boolean },
) {
  return inTenant(deps.prisma, actor.tenantId, (scope) =>
    addNote(scope, caseId, actor.agentId, input.content, input.isInternal));
}

export function linkConversationToCaseFlow(deps: CaseFlowDeps, actor: RequestActor, caseId: string, conversationId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const linked = await linkConversationToCase(scope, caseId, conversationId, actor.agentId);
    notifyTenant(scope, deps.io, 'case.updated', { id: caseId, conversationId });
    return linked;
  });
}

export function deleteCaseFlow(deps: CaseFlowDeps, actor: RequestActor, caseId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const deleted = await deleteCase(scope, caseId);
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'case.delete',
      targetType: 'case',
      targetId: caseId,
      ip: actor.ip,
    });
    notifyTenant(scope, deps.io, 'case.deleted', {
      id: deleted.id,
      status: deleted.status,
      priority: deleted.priority,
      assigneeId: deleted.assigneeId,
      title: deleted.title,
    });
    return { id: deleted.id };
  });
}
