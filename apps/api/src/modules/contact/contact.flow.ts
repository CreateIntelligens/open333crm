/**
 * contact 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：聯絡人的查詢、修改，以及客服手動合併與解除合併。
 *
 * - 合併、解除合併的稽核與資料一起 commit；稽核寫入失敗時整筆 rollback（主規格 tenant-audit-log）。
 * - contact.merged、contact.merge_reverted 推播在 commit 之後送出，rollback 時丟棄。
 * - 綁定代碼、email／手機登記、合併建議也會合併聯絡人，它們尚未搬遷，各自開交易與推播。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { flowOf, inTenant } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import { notifyTenant } from '../../events/socket-push.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  getContact,
  getContactCases,
  getContactConversations,
  getContactMessages,
  getContactTimeline,
  getMergePreview,
  listContacts,
  updateContact,
} from './contact.service.js';
import { listMergeLogs, mergeContacts, revertMerge } from './contact-merge.service.js';

export interface ContactFlowDeps {
  prisma: PrismaClient;
  io: Server;
}

export const listContactsFlow = flowOf(listContacts);
export const getContactFlow = flowOf(getContact);
export const updateContactFlow = flowOf(updateContact);
export const getContactMessagesFlow = flowOf(getContactMessages);
export const getContactConversationsFlow = flowOf(getContactConversations);
export const getContactCasesFlow = flowOf(getContactCases);
export const getContactTimelineFlow = flowOf(getContactTimeline);
export const getMergePreviewFlow = flowOf(getMergePreview);
export const listMergeLogsFlow = flowOf(listMergeLogs);

export function mergeContactsFlow(
  deps: ContactFlowDeps,
  actor: RequestActor,
  input: { primaryContactId: string; secondaryContactId: string },
) {
  const { primaryContactId, secondaryContactId } = input;
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await mergeContacts(scope, {
      survivorId: primaryContactId,
      mergedId: secondaryContactId,
      source: 'MANUAL',
      actorAgentId: actor.agentId,
    });
    // 稽核只放兩造 id，不放姓名、電話等個資明文
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'contact.merge',
      targetType: 'contact',
      targetId: primaryContactId,
      payload: { primaryContactId, secondaryContactId },
      ip: actor.ip,
    });
    const names = { primaryName: result.survivor.displayName, secondaryName: result.merged.displayName };
    notifyTenant(scope, deps.io, 'contact.merged', { primaryContactId, secondaryContactId, ...names });
    return { primaryContactId, secondaryContactId, ...names, mergeLogId: result.mergeLogId };
  });
}

/** 解除一次合併（任何來源的合併都可以） */
export function revertMergeFlow(deps: ContactFlowDeps, actor: RequestActor, mergeLogId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const result = await revertMerge(scope, { mergeLogId, revertedBy: actor.agentId });
    await recordTenantAudit(scope, {
      actorId: actor.agentId,
      action: 'contact.merge_revert',
      targetType: 'contact',
      targetId: result.restoredContactId,
      payload: { mergeLogId, survivorId: result.survivorId, source: result.source },
      ip: actor.ip,
    });
    notifyTenant(scope, deps.io, 'contact.merge_reverted', {
      mergeLogId,
      survivorId: result.holderId,
      restoredContactId: result.restoredContactId,
    });
    return result;
  });
}
