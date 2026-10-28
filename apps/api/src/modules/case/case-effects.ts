/**
 * case 模組的推播與事件（#337 階段 3，AGENTS.md 結構規則 2）。
 *
 * service 只回傳結果；flow 依結果呼叫這裡的函式。同一種推播或事件有多個入口
 * （例如狀態轉換有頂部按鈕與詳情頁下拉兩個入口），內容在這裡組一次，入口不各自組。
 * 推播在 commit 之後送出；事件與資料一起寫進 outbox。
 */
import type { Server } from 'socket.io';
import type { TenantScope } from '../../lib/tenant-ctx.js';
import { notifyTenant } from '../../events/socket-push.js';
import { publishEvent, type EventPublisher } from '../../events/outbox-publisher.js';
import type { escalateCase, transitionCase } from './case.service.js';

export interface CaseEffectDeps {
  io: Server;
  events: EventPublisher;
}

interface CaseRow {
  id: string;
  status: string;
  priority: string;
  assigneeId: string | null;
}

/** 工單列表與詳情頁重新載入這張工單。extra 放在固定欄位之後，例如自動派案的 source */
export function notifyCaseUpdated(scope: TenantScope, io: Server, row: CaseRow, extra: Record<string, unknown> = {}): void {
  notifyTenant(scope, io, 'case.updated', {
    id: row.id,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    ...extra,
  });
}

/** 新工單：推播給畫面，並發 case.created 給自動化與 webhook */
export async function caseCreatedEffects(
  scope: TenantScope,
  deps: CaseEffectDeps,
  caseRecord: CaseRow & { contactId: string; channelId: string; title: string },
  conversationId: string | null,
): Promise<void> {
  notifyTenant(scope, deps.io, 'case.created', {
    id: caseRecord.id,
    status: caseRecord.status,
    priority: caseRecord.priority,
    assigneeId: caseRecord.assigneeId,
    title: caseRecord.title,
  });
  await publishEvent(scope, deps.events, 'case.created', {
    caseId: caseRecord.id,
    contactId: caseRecord.contactId,
    channelId: caseRecord.channelId,
    title: caseRecord.title,
    priority: caseRecord.priority,
    status: caseRecord.status,
    ...(conversationId ? { conversationId } : {}),
  });
}

/** 指派成員（手動或自動派案）：發 case.assigned 給通知。source 只在自動派案時帶 */
export function publishCaseAssigned(
  scope: TenantScope,
  events: EventPublisher,
  input: { caseId: string; assigneeId: string; title: string; source?: 'auto_assign' },
): Promise<void> {
  return publishEvent(scope, events, 'case.assigned', {
    caseId: input.caseId,
    assigneeId: input.assigneeId,
    title: input.title,
    ...(input.source ? { source: input.source } : {}),
  });
}

/** 狀態轉換：推播，轉成已解決、已關閉時再發 case.resolved、case.closed 給 CSAT 與自動化 */
export async function caseTransitionedEffects(
  scope: TenantScope,
  deps: CaseEffectDeps,
  transition: Awaited<ReturnType<typeof transitionCase>>,
): Promise<void> {
  const { updated, before, toStatus } = transition;
  notifyCaseUpdated(scope, deps.io, updated);
  if (toStatus !== 'RESOLVED' && toStatus !== 'CLOSED') return;

  const conversationId = before.conversations[0]?.id ?? null;
  await publishEvent(scope, deps.events, toStatus === 'RESOLVED' ? 'case.resolved' : 'case.closed', {
    caseId: updated.id,
    contactId: before.contactId,
    channelId: before.channelId,
    assigneeId: before.assigneeId,
    title: before.title,
    ...(conversationId ? { conversationId } : {}),
  });
}

/** 升級：推播，並發 case.escalated 給自動化與升級通知 */
export async function caseEscalatedEffects(
  scope: TenantScope,
  deps: CaseEffectDeps,
  escalation: Awaited<ReturnType<typeof escalateCase>>,
): Promise<void> {
  const { updated, before, agentId, body } = escalation;
  notifyCaseUpdated(scope, deps.io, updated);
  await publishEvent(scope, deps.events, 'case.escalated', {
    caseId: updated.id,
    contactId: before.contactId,
    previousPriority: before.priority,
    newPriority: updated.priority,
    status: updated.status,
    reason: body?.reason ?? null,
    // 通知 worker 依這三個欄位決定通知誰（resolveEscalationRecipients）
    notifyTargets: body?.notifyTargets,
    previousAssigneeId: before.assigneeId ?? null,
    actorId: agentId,
  });
}
