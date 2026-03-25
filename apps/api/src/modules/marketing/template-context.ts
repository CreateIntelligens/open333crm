/**
 * Template Context Resolver — resolves variable values from the database.
 *
 * Given optional contactId / conversationId / caseId, queries the DB and
 * returns a flat `Record<string, string>` ready for the template renderer.
 */

import type { PrismaClient } from '@prisma/client';

interface ResolveContextOpts {
  contactId?: string;
  conversationId?: string;
  caseId?: string;
  tenantId?: string;
}

/**
 * Resolve context variables from DB entities.
 */
export async function resolveContext(
  prisma: PrismaClient,
  opts: ResolveContextOpts,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  // Storage base URL (always available)
  vars['storage.base_url'] =
    process.env.STORAGE_PUBLIC_BASE_URL || 'https://storage.example.com';

  // If conversationId is provided but contactId isn't, resolve contactId from conversation
  let contactId = opts.contactId;
  if (!contactId && opts.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
      select: { contactId: true },
    });
    if (conv) {
      contactId = conv.contactId;
    }
  }

  // ── Contact ─────────────────────────────────────────────────────────────────
  if (contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: { attributes: true },
    });

    if (contact) {
      vars['contact.name'] = contact.displayName;
      if (contact.phone) vars['contact.phone'] = contact.phone;
      if (contact.email) vars['contact.email'] = contact.email;

      // ContactAttribute key→value mapping (as `attribute.*`)
      for (const attr of contact.attributes) {
        vars[`attribute.${attr.key}`] = attr.value;
      }
    }
  }

  // ── Case ────────────────────────────────────────────────────────────────────
  if (opts.caseId) {
    const caseRecord = await prisma.case.findUnique({
      where: { id: opts.caseId },
    });

    if (caseRecord) {
      vars['case.id'] = caseRecord.id;
      vars['case.title'] = caseRecord.title;
      vars['case.status'] = caseRecord.status;
      vars['case.priority'] = caseRecord.priority;
      if (caseRecord.category) vars['case.category'] = caseRecord.category;
    }
  }

  return vars;
}
