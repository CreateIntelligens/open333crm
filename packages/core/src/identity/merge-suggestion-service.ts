/**
 * Merge Suggestion Service (Task 4.3)
 * 列出合併建議，並處理核准／拒絕的「建議狀態」部分。
 *
 * 實際合併聯絡人不在這裡做：核准路由會在同一個 withTenant 交易內先呼叫
 * claimSuggestionForApproval，再呼叫 API 端的統一合併引擎（contact-merge.service.ts），
 * 確保所有合併路徑搬移的資料一致（change add-cross-channel-one-id）。
 *
 * 依 CM-175 規範，本檔不使用 @open333crm/database 的模組層 prisma 單例，
 * 一律由呼叫端傳入已綁定租戶的執行器。
 */

import { logger } from '../logger/index.js';
import type { PrismaExecutor } from './identity-stitcher.js';

// ── List Suggestions ───────────────────────────────────────────────────────

export type SuggestionStatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export interface MergeSuggestionWithContacts {
  id: string;
  tenantId: string;
  primaryContactId: string;
  secondaryContactId: string;
  reason: string;
  confidence: number;
  status: string;
  createdAt: Date;
  primaryContact: { id: string; displayName: string; phone: string | null; email: string | null };
  secondaryContact: { id: string; displayName: string; phone: string | null; email: string | null };
}

/**
 * 列出租戶的合併建議。
 */
export async function listSuggestions(
  db: PrismaExecutor,
  tenantId: string,
  status: SuggestionStatusFilter = 'PENDING',
  opts: { page?: number; limit?: number } = {},
): Promise<{ suggestions: MergeSuggestionWithContacts[]; total: number }> {
  const { page = 1, limit = 20 } = opts;
  const skip = (page - 1) * limit;

  const [total, rows] = await Promise.all([
    db.mergeSuggestion.count({ where: { tenantId, status } }),
    db.mergeSuggestion.findMany({
      where: { tenantId, status },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  const contactIds = [...new Set(rows.flatMap((r) => [r.primaryContactId, r.secondaryContactId]))];
  const contacts = await db.contact.findMany({
    where: { tenantId, id: { in: contactIds } },
    select: { id: true, displayName: true, phone: true, email: true },
  });
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  const suggestions = rows
    .filter((r) => contactMap.has(r.primaryContactId) && contactMap.has(r.secondaryContactId))
    .map((r) => ({
      ...r,
      primaryContact: contactMap.get(r.primaryContactId)!,
      secondaryContact: contactMap.get(r.secondaryContactId)!,
    })) as MergeSuggestionWithContacts[];

  return { suggestions, total };
}

// ── Approve ────────────────────────────────────────────────────────────────

export class SuggestionNotFoundError extends Error {
  constructor(suggestionId: string) {
    super(`Merge suggestion ${suggestionId} not found`);
    this.name = 'SuggestionNotFoundError';
  }
}

export class SuggestionNotPendingError extends Error {
  constructor(
    suggestionId: string,
    public readonly status: string,
  ) {
    super(`Merge suggestion ${suggestionId} is already ${status}`);
    this.name = 'SuggestionNotPendingError';
  }
}

/**
 * 核准前的檢查與狀態更新：確認建議屬於此租戶且仍待審核，並標為 APPROVED。
 * 必須與後續的合併在同一交易內呼叫，合併失敗時狀態會一併回滾。
 *
 * @returns 建議的主／次聯絡人 id，供呼叫端交給合併引擎
 */
export async function claimSuggestionForApproval(
  db: PrismaExecutor,
  tenantId: string,
  suggestionId: string,
  agentId: string,
): Promise<{ primaryContactId: string; secondaryContactId: string }> {
  const suggestion = await db.mergeSuggestion.findFirst({ where: { id: suggestionId, tenantId } });
  if (!suggestion) throw new SuggestionNotFoundError(suggestionId);
  if (suggestion.status !== 'PENDING') throw new SuggestionNotPendingError(suggestionId, suggestion.status);

  await db.mergeSuggestion.update({
    where: { id: suggestionId, tenantId },
    data: { status: 'APPROVED', reviewedById: agentId, reviewedAt: new Date() },
  });

  logger.info(
    `[MergeSuggestion] Approved ${suggestionId}: ${suggestion.secondaryContactId} → ${suggestion.primaryContactId} (by ${agentId})`,
  );

  return {
    primaryContactId: suggestion.primaryContactId,
    secondaryContactId: suggestion.secondaryContactId,
  };
}

// ── Reject Suggestion ──────────────────────────────────────────────────────

export async function rejectMerge(
  db: PrismaExecutor,
  tenantId: string,
  suggestionId: string,
  agentId: string,
): Promise<void> {
  const suggestion = await db.mergeSuggestion.findFirst({ where: { id: suggestionId, tenantId } });
  if (!suggestion) throw new SuggestionNotFoundError(suggestionId);
  if (suggestion.status !== 'PENDING') throw new SuggestionNotPendingError(suggestionId, suggestion.status);

  await db.mergeSuggestion.update({
    where: { id: suggestionId, tenantId },
    data: { status: 'REJECTED', reviewedById: agentId, reviewedAt: new Date() },
  });
}
