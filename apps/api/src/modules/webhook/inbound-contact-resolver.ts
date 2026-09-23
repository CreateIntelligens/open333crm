import { resolveUidToContact, logger } from '@open333crm/core';
import { eventBus } from '../../events/event-bus.js';
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
      ctx.prisma,
      ctx.tenantId,
      ctx.channel.channelType as never,
      ctx.contactUid,
    );

    if (stitchedContactId) {
      const stitchedContact = await ctx.prisma.contact.findFirst({
        where: { id: stitchedContactId, tenantId: ctx.tenantId },
      });

      if (stitchedContact) {
        try {
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
          // 此 uid 在本渠道確實是第一次出現（聯絡人雖已存在於其他渠道）。
          ctx.isFirstContact = true;
        } catch (err) {
          // 兩則訊息同時解析到同一 stitched contact 時，另一請求可能已先建立 identity。
          // 撞 P2002 表示對方才是首次，本次不標記。
          if ((err as { code?: string }).code !== 'P2002') throw err;
          channelIdentity = await ctx.prisma.channelIdentity.findUnique({
            where: { channelId_uid: { channelId: ctx.channel.id, uid: ctx.contactUid } },
            include: { contact: true },
          });
          if (!channelIdentity) throw err;
        }
        if (!channelIdentity) {
          throw new Error(`Failed to resolve stitched identity for channel uid ${ctx.contactUid}`);
        }
        contactId = channelIdentity.contactId;
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

    try {
      channelIdentity = await ctx.prisma.channelIdentity.create({
        data: {
          contactId: newContact.id,
          channelId: ctx.channel.id,
          channelType: ctx.channel.channelType as never,
          uid: ctx.contactUid,
          profileName: displayName,
          profilePic: avatarUrl ?? null,
        },
        include: { contact: true },
      });
      // 全新聯絡人 + 全新渠道身分：這是不折不扣的首次進站。
      ctx.isFirstContact = true;
    } catch (err) {
      // 同一新聯絡人的兩則訊息（或平台重複投遞）併發進來時，另一請求可能已先建立
      // 同 (channelId, uid) 的 identity → 撞 P2002。改用對方建立的，回收本次孤兒 contact。
      // 撞到表示對方才是首次，本次不標記（招呼語因此只會送一次）。
      if ((err as { code?: string }).code !== 'P2002') throw err;
      channelIdentity = await ctx.prisma.channelIdentity.findUnique({
        where: { channelId_uid: { channelId: ctx.channel.id, uid: ctx.contactUid } },
        include: { contact: true },
      });
      if (!channelIdentity) throw err;
      contactId = channelIdentity.contactId;
      await ctx.prisma.contact.update({
        where: { id: newContact.id },
        data: { isArchived: true },
      }).catch(() => {
        /* 孤兒 contact 標記失敗不影響主流程 */
      });
    }
  }

  if (!contactId) {
    throw new Error(`Failed to resolve contact for channel uid ${ctx.contactUid}`);
  }

  ctx.contactId = contactId;
  ctx.channelIdentity = channelIdentity;

  // 首次建立渠道身分時發布 contact.created，供自動化規則觸發。
  // fire-and-forget：事件發布失敗不得影響聯絡人/對話/訊息的落地。
  if (ctx.isFirstContact) {
    try {
      const contact = channelIdentity?.contact as
        | { displayName?: string | null; email?: string | null; phone?: string | null }
        | undefined;

      eventBus.publish({
        name: 'contact.created',
        tenantId: ctx.tenantId,
        timestamp: ctx.now,
        payload: {
          contactId,
          channelId: ctx.channel.id,
          channelType: ctx.channel.channelType,
          uid: ctx.contactUid,
          displayName: contact?.displayName ?? null,
          email: contact?.email ?? null,
          phone: contact?.phone ?? null,
        },
      });
    } catch (err) {
      logger.error('[Webhook] Failed to publish contact.created', err);
    }
  }
}
