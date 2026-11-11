/**
 * contact 的 flow（#337 階段 3，AGENTS.md 結構規則 2）：聯絡人的查詢、修改、客服手動合併、合併建議的審核，以及解除合併。
 *
 * - 合併、解除合併的稽核與資料一起 commit；稽核寫入失敗時整筆 rollback（主規格 tenant-audit-log）。
 * - contact.merged、contact.merge_reverted 推播在 commit 之後送出，rollback 時丟棄。
 * - 綁定代碼、email／手機登記也會合併聯絡人，它們尚未搬遷，各自開交易與推播。
 */
import type { PrismaClient } from '@prisma/client';
import type { Server } from 'socket.io';
import { claimSuggestionForApproval, listSuggestions, rejectMerge } from '@open333crm/core';
import { flowOf, inTenant, type TenantCtx, type TenantScope } from '../../lib/tenant-ctx.js';
import type { RequestActor } from '../../lib/request-actor.js';
import type { AccessibleChannels } from '../../services/channel-visibility.js';
import { notifyTenant } from '../../events/socket-push.js';
import { recordTenantAudit } from '../tenant-audit/tenant-audit.service.js';
import {
  assertContactsVisible,
  getContact,
  getContactCases,
  getContactConversations,
  getContactMessages,
  getContactTimeline,
  assertMergeLogVisible,
  assertMergeAllowed,
  getMergePreview,
  listContacts,
  updateContact,
} from './contact.service.js';
import { listMergeLogs, mergeContacts, revertMerge } from './contact-merge.service.js';

export interface ContactFlowDeps {
  prisma: PrismaClient;
  io: Server;
}

export const assertContactsVisibleFlow = flowOf(assertContactsVisible);
export const listContactsFlow = flowOf(listContacts);
export const getContactFlow = flowOf(getContact);
export const updateContactFlow = flowOf(updateContact);
export const getContactMessagesFlow = flowOf(getContactMessages);
export const getContactConversationsFlow = flowOf(getContactConversations);
export const getContactCasesFlow = flowOf(getContactCases);
export const getContactTimelineFlow = flowOf(getContactTimeline);
export const getMergePreviewFlow = flowOf(getMergePreview);
export const listMergeLogsFlow = flowOf(listMergeLogs);

/** contact.merged 的推播內容。手動合併與核准合併建議共用 */
function notifyContactMerged(
  scope: TenantScope,
  io: Server,
  ids: { primaryContactId: string; secondaryContactId: string },
  result: { survivor: { displayName: string | null }; merged: { displayName: string | null } },
) {
  const names = { primaryName: result.survivor.displayName, secondaryName: result.merged.displayName };
  notifyTenant(scope, io, 'contact.merged', { ...ids, ...names });
  return names;
}

export function mergeContactsFlow(
  deps: ContactFlowDeps,
  actor: RequestActor,
  input: { primaryContactId: string; secondaryContactId: string },
  /** 兩位任一看不到回 404、在其他分店渠道還有資料回 403（channel-scoped-visibility），與合併在同一個交易 */
  accessibleChannels: AccessibleChannels,
) {
  const { primaryContactId, secondaryContactId } = input;
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await assertMergeAllowed(scope, [primaryContactId, secondaryContactId], accessibleChannels);
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
    const names = notifyContactMerged(scope, deps.io, { primaryContactId, secondaryContactId }, result);
    return { primaryContactId, secondaryContactId, ...names, mergeLogId: result.mergeLogId };
  });
}

/** 解除一次合併（任何來源的合併都可以） */
export function revertMergeFlow(
  deps: ContactFlowDeps,
  actor: RequestActor,
  mergeLogId: string,
  /** 兩方任一看不到回 404、在其他分店渠道還有資料回 403，與解除合併在同一個交易 */
  accessibleChannels: AccessibleChannels,
) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    await assertMergeLogVisible(scope, mergeLogId, accessibleChannels);
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

// ── 合併建議 ──────────────────────────────────────────────────────────────────
// 建議找不到、已處理時，core 丟 SuggestionNotFoundError、SuggestionNotPendingError，由路由轉成 HTTP 錯誤。

export const listMergeSuggestionsFlow = flowOf(
  (ctx: TenantCtx, status: Parameters<typeof listSuggestions>[2], opts: { page: number; limit: number }) =>
    listSuggestions(ctx.tx, ctx.tenantId, status, opts),
);

/** 認領建議與合併在同一個交易：合併失敗時建議維持 PENDING（主規格 identity-stitching-engine） */
export function approveMergeSuggestionFlow(deps: ContactFlowDeps, actor: RequestActor, suggestionId: string) {
  return inTenant(deps.prisma, actor.tenantId, async (scope) => {
    const ids = await claimSuggestionForApproval(scope.tx, scope.tenantId, suggestionId, actor.agentId);
    const result = await mergeContacts(scope, {
      survivorId: ids.primaryContactId,
      mergedId: ids.secondaryContactId,
      source: 'SUGGESTION',
      actorAgentId: actor.agentId,
    });
    notifyContactMerged(scope, deps.io, ids, result);
    return { mergeLogId: result.mergeLogId };
  });
}

export const rejectMergeSuggestionFlow = flowOf((ctx: TenantCtx, agentId: string, suggestionId: string) =>
  rejectMerge(ctx.tx, ctx.tenantId, suggestionId, agentId),
);

