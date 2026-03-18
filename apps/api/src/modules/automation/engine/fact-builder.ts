/**
 * Fact builder – assembles a flat fact object from database context.
 *
 * This decouples the data-fetching layer from the rule engine so that
 * rules only reference simple fact keys like 'contact.name', 'message.text', etc.
 */

import type { PrismaClient } from '@prisma/client';

export interface FactContext {
  tenantId: string;
  contactId?: string;
  conversationId?: string;
  messageContent?: string;
  caseId?: string;
}

export interface AutomationFacts {
  'contact.name': string | null;
  'contact.channel': string[];
  'contact.tags': string[];
  'contact.language': string | null;
  'case.open.count': number;
  'message.text': string | null;
  'is_vip_customer': boolean;
  'conversation.channelType': string | null;
  'conversation.status': string | null;
  [key: string]: unknown;
}

/**
 * Fetch related entities from the database and build a flat fact map
 * suitable for evaluation by json-rules-engine.
 */
export async function buildFacts(
  prisma: PrismaClient,
  context: FactContext,
): Promise<AutomationFacts> {
  let contact: {
    id: string;
    displayName: string;
    language: string;
    tags: Array<{ tag: { name: string } }>;
    channelIdentities: Array<{ channelType: string }>;
  } | null = null;

  let channelTypes: string[] = [];
  let tagNames: string[] = [];
  let openCaseCount = 0;

  // Fetch contact with tags and channel identities
  if (context.contactId) {
    contact = await prisma.contact.findUnique({
      where: { id: context.contactId },
      select: {
        id: true,
        displayName: true,
        language: true,
        tags: {
          select: {
            tag: {
              select: { name: true },
            },
          },
        },
        channelIdentities: {
          select: {
            channelType: true,
          },
        },
      },
    });

    if (contact) {
      channelTypes = [...new Set(contact.channelIdentities.map((ci) => ci.channelType))];
      tagNames = contact.tags.map((ct) => ct.tag.name);

      // Count open cases for this contact in this tenant
      openCaseCount = await prisma.case.count({
        where: {
          tenantId: context.tenantId,
          contactId: context.contactId,
          status: { in: ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED'] },
        },
      });
    }
  }

  // Fetch conversation details
  let conversation: {
    channelType: string;
    status: string;
  } | null = null;

  if (context.conversationId) {
    conversation = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: {
        channelType: true,
        status: true,
      },
    });
  }

  return {
    'contact.name': contact?.displayName ?? null,
    'contact.channel': channelTypes,
    'contact.tags': tagNames,
    'contact.language': contact?.language ?? null,
    'case.open.count': openCaseCount,
    'message.text': context.messageContent ?? null,
    'is_vip_customer': tagNames.includes('VIP'),
    'conversation.channelType': conversation?.channelType ?? null,
    'conversation.status': conversation?.status ?? null,
  };
}
