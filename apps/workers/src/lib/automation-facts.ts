import type { PrismaClient } from '@prisma/client';

export interface AutomationFactContext {
  tenantId: string;
  contactId?: string;
  conversationId?: string;
  messageContent?: string;
  caseId?: string;
  [key: string]: unknown;
}

export async function buildAutomationFacts(
  prisma: PrismaClient,
  context: AutomationFactContext,
): Promise<Record<string, unknown>> {
  let contact: {
    displayName: string;
    language: string;
    tags: Array<{ tag: { name: string } }>;
    channelIdentities: Array<{ channelType: string }>;
  } | null = null;

  if (context.contactId) {
    contact = await prisma.contact.findFirst({
      where: { id: context.contactId, tenantId: context.tenantId },
      select: {
        displayName: true,
        language: true,
        tags: { select: { tag: { select: { name: true } } } },
        channelIdentities: { select: { channelType: true } },
      },
    });
  }

  let conversation: {
    channelType: string;
    status: string;
    assignedToId: string | null;
    caseId: string | null;
  } | null = null;

  if (context.conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: context.conversationId, tenantId: context.tenantId },
      select: {
        channelType: true,
        status: true,
        assignedToId: true,
        caseId: true,
      },
    });
  }

  const effectiveCaseId = context.caseId ?? conversation?.caseId ?? undefined;
  let caseRecord: {
    id: string;
    status: string;
    priority: string;
    assigneeId: string | null;
    teamId: string | null;
    category: string | null;
  } | null = null;

  if (effectiveCaseId) {
    caseRecord = await prisma.case.findFirst({
      where: { id: effectiveCaseId, tenantId: context.tenantId },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeId: true,
        teamId: true,
        category: true,
      },
    });
  }

  const tagNames = contact?.tags.map((tag) => tag.tag.name) ?? [];
  const channelTypes = [
    ...new Set(contact?.channelIdentities.map((identity) => identity.channelType) ?? []),
  ];
  const openCaseCount = context.contactId
    ? await prisma.case.count({
        where: {
          tenantId: context.tenantId,
          contactId: context.contactId,
          status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] },
        },
      })
    : 0;

  return {
    ...context,
    'contact.name': contact?.displayName ?? null,
    'contact.channel': channelTypes,
    'contact.tags': tagNames,
    'contact.language': contact?.language ?? null,
    'case.open.count': openCaseCount,
    'message.text': context.messageContent ?? null,
    is_vip_customer: tagNames.includes('VIP'),
    'conversation.channelType': conversation?.channelType ?? null,
    'conversation.status': conversation?.status ?? null,
    'conversation.assignedToId': conversation?.assignedToId ?? null,
    caseId: effectiveCaseId ?? null,
    'case.id': caseRecord?.id ?? effectiveCaseId ?? null,
    'case.status': caseRecord?.status ?? null,
    'case.priority': caseRecord?.priority ?? null,
    'case.assigneeId': caseRecord?.assigneeId ?? null,
    'case.teamId': caseRecord?.teamId ?? null,
    'case.category': caseRecord?.category ?? null,
  };
}
