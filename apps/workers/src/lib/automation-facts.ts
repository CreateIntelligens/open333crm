import type { PrismaClient } from '@prisma/client';
import { AUTOMATION_FACT_KEYS } from '@open333crm/automation';

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
    [AUTOMATION_FACT_KEYS.CONTACT_NAME]: contact?.displayName ?? null,
    [AUTOMATION_FACT_KEYS.CONTACT_CHANNEL]: channelTypes,
    [AUTOMATION_FACT_KEYS.CONTACT_TAGS]: tagNames,
    [AUTOMATION_FACT_KEYS.CONTACT_LANGUAGE]: contact?.language ?? null,
    [AUTOMATION_FACT_KEYS.CASE_OPEN_COUNT]: openCaseCount,
    [AUTOMATION_FACT_KEYS.MESSAGE_TEXT]: context.messageContent ?? null,
    is_vip_customer: tagNames.includes('VIP'),
    [AUTOMATION_FACT_KEYS.CONTACT_IS_VIP]: tagNames.includes('VIP'),
    [AUTOMATION_FACT_KEYS.CONVERSATION_CHANNEL_TYPE]: conversation?.channelType ?? null,
    [AUTOMATION_FACT_KEYS.CONVERSATION_STATUS]: conversation?.status ?? null,
    [AUTOMATION_FACT_KEYS.CONVERSATION_ASSIGNED_TO_ID]:
      conversation?.assignedToId ?? null,
    caseId: effectiveCaseId ?? null,
    [AUTOMATION_FACT_KEYS.CASE_ID]: caseRecord?.id ?? effectiveCaseId ?? null,
    [AUTOMATION_FACT_KEYS.CASE_STATUS]: caseRecord?.status ?? null,
    [AUTOMATION_FACT_KEYS.CASE_PRIORITY]: caseRecord?.priority ?? null,
    [AUTOMATION_FACT_KEYS.CASE_ASSIGNEE_ID]: caseRecord?.assigneeId ?? null,
    [AUTOMATION_FACT_KEYS.CASE_TEAM_ID]: caseRecord?.teamId ?? null,
    [AUTOMATION_FACT_KEYS.CASE_CATEGORY]: caseRecord?.category ?? null,
  };
}
