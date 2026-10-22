/**
 * 自動化規則評估用的 facts。workers 執行規則與 API 判斷 AI 是否讓步（hasMatchingKeywordRule）共用，
 * 兩邊才會對同一則訊息得出相同的條件結果（change fix-automation-rule-gaps）。
 *
 * 收呼叫端的 Prisma executor（AGENTS.md 結構規則 2）；workers 與 API 這條路徑都走 BYPASSRLS 連線，
 * 每個查詢都自帶 tenantId。
 */
import { AUTOMATION_FACT_KEYS } from './contracts/facts.js';

/** buildAutomationFacts 用到的 Prisma model 方法。PrismaClient 與交易 client 都符合 */
export interface AutomationFactsDb {
  contact: { findFirst(args: any): PromiseLike<any> };
  conversation: { findFirst(args: any): PromiseLike<any> };
  case: { findFirst(args: any): PromiseLike<any>; count(args: any): PromiseLike<number> };
}

export interface AutomationFactContext {
  tenantId: string;
  contactId?: string;
  conversationId?: string;
  messageContent?: string;
  caseId?: string;
  [key: string]: unknown;
}

export async function buildAutomationFacts(
  prisma: AutomationFactsDb,
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
    // 加入好友事件才有（API 依渠道身分的加入紀錄判斷）；沒有值時條件「第一次加入等於是」不成立
    [AUTOMATION_FACT_KEYS.FOLLOW_IS_FIRST]: typeof context.isFirstFollow === 'boolean' ? context.isFirstFollow : null,
  };
}
