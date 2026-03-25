import type { PrismaClient } from '@prisma/client';

const TRACKING_WINDOW_HOURS = 48;

/**
 * When a contact replies (inbound message), mark recent broadcast recipients as replied.
 * Only marks the most recent un-replied recipient within the tracking window.
 */
export async function trackBroadcastReply(
  prisma: PrismaClient,
  contactId: string,
) {
  const cutoff = new Date(Date.now() - TRACKING_WINDOW_HOURS * 60 * 60 * 1000);

  const recipient = await prisma.broadcastRecipient.findFirst({
    where: {
      contactId,
      replied: false,
      sentAt: { gte: cutoff },
    },
    orderBy: { sentAt: 'desc' },
  });

  if (recipient) {
    await prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: { replied: true, firstReplyAt: new Date() },
    });
  }
}

/**
 * When a case is created for a contact, link it to the most recent broadcast recipient.
 */
export async function trackBroadcastCase(
  prisma: PrismaClient,
  contactId: string,
  caseId: string,
) {
  const cutoff = new Date(Date.now() - TRACKING_WINDOW_HOURS * 60 * 60 * 1000);

  const recipient = await prisma.broadcastRecipient.findFirst({
    where: {
      contactId,
      caseId: null,
      sentAt: { gte: cutoff },
    },
    orderBy: { sentAt: 'desc' },
  });

  if (recipient) {
    await prisma.broadcastRecipient.update({
      where: { id: recipient.id },
      data: { caseId, caseCreatedAt: new Date() },
    });
  }
}
