import type { Prisma, PrismaClient } from '@prisma/client';
import { eventBus } from '../../events/event-bus.js';
import { AppError } from '../../shared/utils/response.js';
import type { TenantScopedClient, TenantDb } from '../../lib/tenant-db.js';

export type TagTargetType = 'CONTACT' | 'CASE' | 'CONVERSATION';
type TagKind = 'MANUAL' | 'AUTO' | 'SYSTEM' | 'CHANNEL';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient | TenantScopedClient;

interface TargetInput {
  tenantId: string;
  targetType: TagTargetType;
  targetId: string;
}

interface AddTagInput extends TargetInput {
  tagId: string;
  agentId: string;
}

interface RemoveTagInput extends TargetInput {
  tagId: string;
}

interface CreateTagInput {
  tenantId: string;
  name: string;
  color: string;
  type: TagKind;
  scope: TagTargetType;
  description?: string;
}

interface UpdateTagInput {
  tenantId: string;
  tagId: string;
  name?: string;
  color?: string;
  description?: string;
}

const TAG_SELECT = {
  id: true,
  name: true,
  color: true,
  type: true,
  scope: true,
  description: true,
} satisfies Prisma.TagSelect;

async function assertTargetExists(
  prisma: PrismaExecutor,
  { tenantId, targetType, targetId }: TargetInput,
) {
  switch (targetType) {
    case 'CONTACT': {
      const target = await prisma.contact.findFirst({
        where: { id: targetId, tenantId },
        select: { id: true },
      });
      if (!target) throw new AppError('Contact not found', 'NOT_FOUND', 404);
      return;
    }
    case 'CASE': {
      const target = await prisma.case.findFirst({
        where: { id: targetId, tenantId },
        select: { id: true },
      });
      if (!target) throw new AppError('Case not found', 'NOT_FOUND', 404);
      return;
    }
    case 'CONVERSATION': {
      const target = await prisma.conversation.findFirst({
        where: { id: targetId, tenantId },
        select: { id: true },
      });
      if (!target) throw new AppError('Conversation not found', 'NOT_FOUND', 404);
      return;
    }
  }
}

async function getTenantTag(
  prisma: PrismaExecutor,
  tenantId: string,
  tagId: string,
) {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, tenantId },
    select: TAG_SELECT,
  });
  if (!tag) throw new AppError('Tag not found', 'NOT_FOUND', 404);
  return tag;
}

function assertTagScope(targetType: TagTargetType, tag: { scope: string }) {
  if (tag.scope !== targetType) {
    throw new AppError(
      `Tag scope ${tag.scope} cannot be assigned to ${targetType}`,
      'TAG_SCOPE_MISMATCH',
      400,
    );
  }
}

export async function addTagToTarget(
  prisma: PrismaExecutor,
  input: AddTagInput,
) {
  await assertTargetExists(prisma, input);
  const tag = await getTenantTag(prisma, input.tenantId, input.tagId);
  assertTagScope(input.targetType, tag);

  switch (input.targetType) {
    case 'CONTACT': {
      const assignment = await prisma.contactTag.upsert({
        where: {
          contactId_tagId: {
            contactId: input.targetId,
            tagId: input.tagId,
          },
        },
        update: {},
        create: {
          contactId: input.targetId,
          tagId: input.tagId,
          addedBy: 'agent',
          addedById: input.agentId,
        },
        include: { tag: { select: TAG_SELECT } },
      });

      eventBus.publish({
        name: 'contact.tagged',
        tenantId: input.tenantId,
        timestamp: new Date(),
        payload: {
          contactId: input.targetId,
          tagId: input.tagId,
          tagName: tag.name,
        },
      });

      return assignment;
    }
    case 'CASE':
      return prisma.caseTag.upsert({
        where: {
          caseId_tagId: {
            caseId: input.targetId,
            tagId: input.tagId,
          },
        },
        update: {},
        create: {
          caseId: input.targetId,
          tagId: input.tagId,
          addedBy: 'agent',
          addedById: input.agentId,
        },
        include: { tag: { select: TAG_SELECT } },
      });
    case 'CONVERSATION':
      return prisma.conversationTag.upsert({
        where: {
          conversationId_tagId: {
            conversationId: input.targetId,
            tagId: input.tagId,
          },
        },
        update: {},
        create: {
          conversationId: input.targetId,
          tagId: input.tagId,
          addedBy: 'agent',
          addedById: input.agentId,
        },
        include: { tag: { select: TAG_SELECT } },
      });
  }
}

export async function createTenantTag(
  prisma: PrismaExecutor,
  input: CreateTagInput,
) {
  const duplicate = await prisma.tag.findFirst({
    where: {
      tenantId: input.tenantId,
      name: input.name,
      scope: input.scope,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new AppError('Tag name already exists in this scope', 'CONFLICT', 409);
  }

  return prisma.tag.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      color: input.color,
      type: input.type,
      scope: input.scope,
      description: input.description,
    },
  });
}

export async function updateTenantTag(
  prisma: PrismaExecutor,
  input: UpdateTagInput,
) {
  const tag = await prisma.tag.findFirst({
    where: { id: input.tagId, tenantId: input.tenantId },
  });

  if (!tag) {
    throw new AppError('Tag not found', 'NOT_FOUND', 404);
  }

  if (input.name && input.name !== tag.name) {
    const duplicate = await prisma.tag.findFirst({
      where: {
        tenantId: input.tenantId,
        name: input.name,
        scope: tag.scope,
        id: { not: tag.id },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError('Tag name already exists in this scope', 'CONFLICT', 409);
    }
  }

  return prisma.tag.update({
    where: { id: input.tagId },
    data: {
      name: input.name,
      color: input.color,
      description: input.description,
    },
  });
}

// 收 TenantDb：呼叫端以 withTenant(prisma, tid, tx => deleteTenantTag(tx, ...)) 包在
// 綁定租戶的交易內，故此處依序刪除即為原子（不自開 $transaction，避免與外層巢狀）。
export async function deleteTenantTag(
  prisma: TenantDb,
  tenantId: string,
  tagId: string,
) {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, tenantId },
    select: { id: true },
  });

  if (!tag) {
    throw new AppError('Tag not found', 'NOT_FOUND', 404);
  }

  await prisma.contactTag.deleteMany({ where: { tagId } });
  await prisma.caseTag.deleteMany({ where: { tagId } });
  await prisma.conversationTag.deleteMany({ where: { tagId } });
  await prisma.tag.delete({ where: { id: tagId } });

  return { deleted: true };
}

export async function removeTagFromTarget(
  prisma: PrismaExecutor,
  input: RemoveTagInput,
) {
  await assertTargetExists(prisma, input);
  const tag = await getTenantTag(prisma, input.tenantId, input.tagId);
  assertTagScope(input.targetType, tag);

  switch (input.targetType) {
    case 'CONTACT': {
      const existing = await prisma.contactTag.findUnique({
        where: {
          contactId_tagId: {
            contactId: input.targetId,
            tagId: input.tagId,
          },
        },
      });
      if (!existing) throw new AppError('Contact tag not found', 'NOT_FOUND', 404);
      await prisma.contactTag.delete({
        where: {
          contactId_tagId: {
            contactId: input.targetId,
            tagId: input.tagId,
          },
        },
      });
      return { success: true };
    }
    case 'CASE': {
      const existing = await prisma.caseTag.findUnique({
        where: {
          caseId_tagId: {
            caseId: input.targetId,
            tagId: input.tagId,
          },
        },
      });
      if (!existing) throw new AppError('Case tag not found', 'NOT_FOUND', 404);
      await prisma.caseTag.delete({
        where: {
          caseId_tagId: {
            caseId: input.targetId,
            tagId: input.tagId,
          },
        },
      });
      return { success: true };
    }
    case 'CONVERSATION': {
      const existing = await prisma.conversationTag.findUnique({
        where: {
          conversationId_tagId: {
            conversationId: input.targetId,
            tagId: input.tagId,
          },
        },
      });
      if (!existing) throw new AppError('Conversation tag not found', 'NOT_FOUND', 404);
      await prisma.conversationTag.delete({
        where: {
          conversationId_tagId: {
            conversationId: input.targetId,
            tagId: input.tagId,
          },
        },
      });
      return { success: true };
    }
  }
}

export async function listTargetTags(
  prisma: PrismaExecutor,
  input: TargetInput,
) {
  await assertTargetExists(prisma, input);

  switch (input.targetType) {
    case 'CONTACT':
      return prisma.contactTag.findMany({
        where: { contactId: input.targetId },
        include: { tag: { select: TAG_SELECT } },
        orderBy: { addedAt: 'desc' },
      });
    case 'CASE':
      return prisma.caseTag.findMany({
        where: { caseId: input.targetId },
        include: { tag: { select: TAG_SELECT } },
        orderBy: { addedAt: 'desc' },
      });
    case 'CONVERSATION':
      return prisma.conversationTag.findMany({
        where: { conversationId: input.targetId },
        include: { tag: { select: TAG_SELECT } },
        orderBy: { addedAt: 'desc' },
      });
  }
}
