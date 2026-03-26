/**
 * Merge Suggestion Service (Task 4.3)
 * Lists AI-generated merge suggestions and handles admin approve/reject with actual merge.
 */

import { prisma } from '@open333crm/database';
import { logger } from '../logger/index.js';

// ── List Suggestions ───────────────────────────────────────────────────────

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
 * List pending merge suggestions for a tenant.
 */
export async function listSuggestions(
  tenantId: string,
  status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING',
  opts: { page?: number; limit?: number } = {},
): Promise<{ suggestions: MergeSuggestionWithContacts[]; total: number }> {
  const { page = 1, limit = 20 } = opts;
  const skip = (page - 1) * limit;

  const [total, rows] = await Promise.all([
    prisma.mergeSuggestion.count({ where: { tenantId, status } }),
    prisma.mergeSuggestion.findMany({
      where: { tenantId, status },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  // Resolve contact details
  const contactIds = [
    ...new Set(rows.flatMap((r) => [r.primaryContactId, r.secondaryContactId])),
  ];
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true, displayName: true, phone: true, email: true },
  });
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  const suggestions = rows.map((r) => ({
    ...r,
    primaryContact: contactMap.get(r.primaryContactId)!,
    secondaryContact: contactMap.get(r.secondaryContactId)!,
  })) as MergeSuggestionWithContacts[];

  return { suggestions, total };
}

// ── Approve Merge ──────────────────────────────────────────────────────────

/**
 * Approve a merge suggestion.
 * Merges secondaryContact into primaryContact:
 *   1. Re-assigns all ChannelIdentity, IdentityMap, Conversation, Case to primary
 *   2. Marks secondaryContact as a relation of primary (for audit)
 *   3. Updates suggestion status to APPROVED
 */
export async function approveMerge(suggestionId: string, agentId: string): Promise<void> {
  const suggestion = await prisma.mergeSuggestion.findUniqueOrThrow({
    where: { id: suggestionId },
  });

  if (suggestion.status !== 'PENDING') {
    throw new Error(`Suggestion ${suggestionId} is already ${suggestion.status}`);
  }

  const { primaryContactId, secondaryContactId, tenantId } = suggestion;

  logger.info(
    `[MergeSuggestion] Merging contact ${secondaryContactId} → ${primaryContactId} (approved by ${agentId})`,
  );

  await prisma.$transaction(async (tx) => {
    // 1. Re-assign channel identities
    await tx.channelIdentity.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 2. Re-assign identity maps
    await tx.identityMap.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 3. Re-assign conversations
    await tx.conversation.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 4. Re-assign cases
    await tx.case.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 5. Re-assign contact tags
    await tx.contactTag.updateMany({
      where: { contactId: secondaryContactId },
      data: { contactId: primaryContactId },
    });

    // 6. Mark secondary as merged into primary (using existing ContactRelation)
    await tx.contactRelation.upsert({
      where: {
        fromContactId_toContactId_relationType: {
          fromContactId: secondaryContactId,
          toContactId: primaryContactId,
          relationType: 'merged_into',
        },
      },
      create: {
        fromContactId: secondaryContactId,
        toContactId: primaryContactId,
        relationType: 'merged_into',
        notes: `Merged by agent ${agentId} via MergeSuggestion ${suggestionId}`,
      },
      update: {},
    });

    // 7. Mark suggestion as APPROVED
    await tx.mergeSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'APPROVED', reviewedById: agentId, reviewedAt: new Date() },
    });
  });

  logger.info(`[MergeSuggestion] Merge complete: ${secondaryContactId} → ${primaryContactId}`);
}

// ── Reject Suggestion ──────────────────────────────────────────────────────

export async function rejectMerge(suggestionId: string, agentId: string): Promise<void> {
  await prisma.mergeSuggestion.update({
    where: { id: suggestionId },
    data: { status: 'REJECTED', reviewedById: agentId, reviewedAt: new Date() },
  });
}
