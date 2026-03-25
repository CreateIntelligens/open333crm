import { prisma, Prisma } from '@open333crm/database';
import { logger } from '../logger';

export class ContactService {
  static async findOrCreateByIdentity(
    tenantId: string,
    channelId: string,
    channelType: any,
    uid: string,
    profile: { name?: string; pic?: string; phone?: string; email?: string }
  ) {
    try {
      // 1. Check if identity exists via channelId + uid
      const identity = await prisma.channelIdentity.findUnique({
        where: { channelId_uid: { channelId, uid } },
        include: { contact: true },
      });

      if (identity) {
        // Update profile if changed
        if (profile.name !== identity.profileName || profile.pic !== identity.profilePic) {
          await prisma.channelIdentity.update({
            where: { id: identity.id },
            data: {
              profileName: profile.name,
              profilePic: profile.pic,
            },
          });
        }
        return identity.contact;
      }

      // 2. Identity not found. Try to find existing contact by Phone or Email for auto-merge
      let existingContact = null;
      if (profile.phone || profile.email) {
        existingContact = await prisma.contact.findFirst({
          where: {
            tenantId,
            OR: [
              ...(profile.phone ? [{ phone: profile.phone }] : []),
              ...(profile.email ? [{ email: profile.email }] : []),
            ],
          },
        });
      }

      if (existingContact) {
        // Create new identity linked to existing contact
        await prisma.channelIdentity.create({
          data: {
            contactId: existingContact.id,
            channelId,
            channelType,
            uid,
            profileName: profile.name,
            profilePic: profile.pic,
          },
        });
        logger.info(`[ContactService] Auto-linked new ${channelType} identity to existing contact ${existingContact.id}`);
        return existingContact;
      }

      // 3. Create entirely new contact and identity
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          displayName: profile.name || 'Unknown User',
          avatarUrl: profile.pic,
          phone: profile.phone,
          email: profile.email,
          channelIdentities: {
            create: {
              channelId,
              channelType,
              uid,
              profileName: profile.name,
              profilePic: profile.pic,
            },
          },
        },
      });

      return contact;
    } catch (err) {
      logger.error('Failed to find or create contact identity:', err);
      throw err;
    }
  }

  static async setAttribute(contactId: string, key: string, value: string, dataType: string = 'string') {
    return prisma.contactAttribute.upsert({
      where: { contactId_key: { contactId, key } },
      update: { value, dataType },
      create: { contactId, key, value, dataType },
    });
  }

  static async mergeContacts(tenantId: string, sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new Error('Cannot merge a contact into itself');

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const source = await tx.contact.findUnique({ where: { id: sourceId, tenantId } });
      const target = await tx.contact.findUnique({ where: { id: targetId, tenantId } });

      if (!source || !target) {
        throw new Error('Source or Target contact not found, or tenant mismatch');
      }

      // 1. Move Channel Identities
      await tx.channelIdentity.updateMany({
        where: { contactId: sourceId },
        data: { contactId: targetId },
      });

      // 2. Move Conversations
      await tx.conversation.updateMany({
        where: { contactId: sourceId },
        data: { contactId: targetId },
      });

      // 3. Move Cases
      await tx.case.updateMany({
        where: { contactId: sourceId },
        data: { contactId: targetId },
      });

      // 4. Move Long Term Memories
      await tx.longTermMemory.updateMany({
        where: { contactId: sourceId },
        data: { contactId: targetId },
      });

      // 5. Move Attributes (Ignore conflicts natively by simply catching or we do it one by one)
      const sourceAttrs = await tx.contactAttribute.findMany({ where: { contactId: sourceId } });
      for (const attr of sourceAttrs) {
        // Upsert avoids unique constraint violations
        await tx.contactAttribute.upsert({
          where: { contactId_key: { contactId: targetId, key: attr.key } },
          update: {}, // keep target's existing value
          create: { contactId: targetId, key: attr.key, value: attr.value, dataType: attr.dataType },
        });
      }

      // 6. Move Tags
      const sourceTags = await tx.contactTag.findMany({ where: { contactId: sourceId } });
      for (const t of sourceTags) {
        // Check if target already has this tag
        const existing = await tx.contactTag.findFirst({
          where: { contactId: targetId, tagId: t.tagId }
        });
        if (!existing) {
          await tx.contactTag.update({
            where: { id: t.id },
            data: { contactId: targetId },
          });
        }
      }

      // 7. Move Relations
      // From source
      await tx.contactRelation.updateMany({
        where: { fromContactId: sourceId },
        data: { fromContactId: targetId },
      });
      // To source
      await tx.contactRelation.updateMany({
        where: { toContactId: sourceId },
        data: { toContactId: targetId },
      });

      // 8. Update profile details if target is missing them
      await tx.contact.update({
        where: { id: targetId },
        data: {
          phone: target.phone || source.phone,
          email: target.email || source.email,
          avatarUrl: target.avatarUrl || source.avatarUrl,
        },
      });

      // 9. Delete source contact
      await tx.contact.delete({ where: { id: sourceId } });

      logger.info(`[ContactService] Successfully merged Contact ${sourceId} into ${targetId}`);
      return targetId;
    });
  }

  static async addTag(contactId: string, tagId: string, addedBy: string = 'system') {
    return prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId } },
      update: { addedAt: new Date() },
      create: { contactId, tagId, addedBy },
    });
  }

  static async getAttribute(contactId: string, key: string) {
    const attr = await prisma.contactAttribute.findUnique({
      where: { contactId_key: { contactId, key } }
    });
    return attr?.value || null;
  }

  static async setAttributes(contactId: string, attributes: Record<string, any>) {
    const promises = Object.entries(attributes).map(([key, value]) => {
      const dataType = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
      return this.setAttribute(contactId, key, String(value), dataType);
    });
    return Promise.all(promises);
  }

  static async updateProfile(contactId: string, tenantId: string, data: { displayName?: string, phone?: string, email?: string, language?: string }) {
    return prisma.contact.update({
      where: { id: contactId, tenantId },
      data,
    });
  }

  static async linkIdentity(contactId: string, channelId: string, channelType: any, uid: string, profile?: { name?: string, pic?: string }) {
    // Manually force-link a channel identity to a specific contact
    return prisma.channelIdentity.upsert({
      where: { channelId_uid: { channelId, uid } },
      update: {
        contactId, // Re-parent if it existed somewhere else
        profileName: profile?.name,
        profilePic: profile?.pic,
      },
      create: {
        contactId,
        channelId,
        channelType,
        uid,
        profileName: profile?.name,
        profilePic: profile?.pic,
      }
    });
  }
}
