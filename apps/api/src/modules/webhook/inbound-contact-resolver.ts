import { resolveUidToContact } from '@open333crm/core';
import type { InboundMessageContext } from './inbound-message.types.js';

export async function resolveInboundContact(ctx: InboundMessageContext): Promise<void> {
  let channelIdentity = await ctx.prisma.channelIdentity.findUnique({
    where: {
      channelId_uid: { channelId: ctx.channel.id, uid: ctx.contactUid },
    },
    include: { contact: true },
  });

  let contactId: string | null = null;

  if (channelIdentity) {
    contactId = channelIdentity.contactId;
  } else {
    const stitchedContactId = await resolveUidToContact(
      ctx.tenantId,
      ctx.channel.channelType as never,
      ctx.contactUid,
    );

    if (stitchedContactId) {
      const stitchedContact = await ctx.prisma.contact.findFirst({
        where: { id: stitchedContactId, tenantId: ctx.tenantId },
      });

      if (stitchedContact) {
        contactId = stitchedContact.id;
        channelIdentity = await ctx.prisma.channelIdentity.create({
          data: {
            contactId: stitchedContact.id,
            channelId: ctx.channel.id,
            channelType: ctx.channel.channelType as never,
            uid: ctx.contactUid,
            profileName: stitchedContact.displayName,
            profilePic: stitchedContact.avatarUrl ?? null,
          },
          include: { contact: true },
        });
      }
    }
  }

  if (!channelIdentity) {
    let displayName = `${ctx.channel.channelType} User ${ctx.contactUid.slice(-6)}`;
    let avatarUrl: string | undefined;

    if (ctx.plugin) {
      try {
        const profile = await ctx.plugin.getProfile(ctx.contactUid, ctx.credentials);
        displayName = profile.displayName;
        avatarUrl = profile.avatarUrl;
      } catch {
        // Use fallback name.
      }
    }

    const newContact = await ctx.prisma.contact.create({
      data: {
        tenantId: ctx.tenantId,
        displayName,
        avatarUrl: avatarUrl ?? null,
        language: 'zh-TW',
      },
    });

    contactId = newContact.id;

    channelIdentity = await ctx.prisma.channelIdentity.create({
      data: {
        contactId: newContact.id,
        channelId: ctx.channel.id,
        channelType: ctx.channel.channelType as any,
        uid: ctx.contactUid,
        profileName: displayName,
        profilePic: avatarUrl ?? null,
      },
      include: { contact: true },
    });
  }

  if (!contactId) {
    throw new Error(`Failed to resolve contact for channel uid ${ctx.contactUid}`);
  }

  ctx.contactId = contactId;
  ctx.channelIdentity = channelIdentity;
}
