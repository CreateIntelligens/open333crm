import { prisma } from '@open333crm/database';
import { logger } from '../logger';

export class ContactService {
  static async findOrCreateByIdentity(tenantId: string, channelId: string, channelType: any, uid: string, profile: { name?: string; pic?: string }) {
    try {
      // 1. Check if identity exists
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

      // 2. Create new contact and identity
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          displayName: profile.name || 'Unknown User',
          avatarUrl: profile.pic,
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

  static async addTag(contactId: string, tagId: string, addedBy: string = 'system') {
    return prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId } },
      update: { addedAt: new Date() },
      create: { contactId, tagId, addedBy },
    });
  }
}
