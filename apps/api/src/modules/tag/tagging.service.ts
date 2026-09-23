import type { Prisma, PrismaClient } from '@prisma/client';
import { eventBus } from '../../events/event-bus.js';
import { AppError } from '../../shared/utils/response.js';
import type { TenantScopedClient, TenantDb } from '../../lib/tenant-db.js';
import { notFound } from '../../shared/messages/resource.js';

/**
 * 可以「貼標」的目標——這三種有各自的關聯表（ContactTag / CaseTag / ConversationTag）。
 * 素材不在此列：素材標籤存在 Material.tags（String[]），沒有關聯表，
 * 不走 addTagToTarget 這條路（見 material.service 的 registerMaterialTags）。
 */
export type TagTargetType = 'CONTACT' | 'CASE' | 'CONVERSATION';

/**
 * 標籤的適用範圍——比 TagTargetType 多一個 MATERIAL。
 * 建立標籤時可指定素材範圍，但素材本身的貼標不經過關聯表。
 */
export type TagScopeType = TagTargetType | 'MATERIAL';
type TagKind = 'MANUAL' | 'AUTO' | 'SYSTEM' | 'CHANNEL';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient | TenantScopedClient;

interface TargetInput {
  tenantId: string;
  targetType: TagTargetType;
  targetId: string;
}

/** 貼標來源：人工 / 短連結點擊 / 自動化規則。影響 addedBy 與 contact.tagged 的 source（迴圈防護用）。 */
export type TagSource = 'agent' | 'system' | 'automation';

interface AddTagInput extends TargetInput {
  tagId: string;
  /** 人工路徑帶操作者；非人工路徑（system/automation）可省略。 */
  agentId?: string;
  /** 預設 'agent'（既有人工呼叫者不受影響）。 */
  addedBy?: TagSource;
}

interface RemoveTagInput extends TargetInput {
  tagId: string;
}

interface CreateTagInput {
  tenantId: string;
  name: string;
  color: string;
  type: TagKind;
  scope: TagScopeType;
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
      if (!target) throw new AppError(notFound('contact'), 'NOT_FOUND', 404);
      return;
    }
    case 'CASE': {
      const target = await prisma.case.findFirst({
        where: { id: targetId, tenantId },
        select: { id: true },
      });
      if (!target) throw new AppError(notFound('case'), 'NOT_FOUND', 404);
      return;
    }
    case 'CONVERSATION': {
      const target = await prisma.conversation.findFirst({
        where: { id: targetId, tenantId },
        select: { id: true },
      });
      if (!target) throw new AppError(notFound('conversation'), 'NOT_FOUND', 404);
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
  if (!tag) throw new AppError(notFound('tag'), 'NOT_FOUND', 404);
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
      const source = input.addedBy ?? 'agent';
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
          addedBy: source,
          addedById: input.agentId ?? null,
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
          source,
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
    throw new AppError('這個範圍內已有同名標籤，請換一個名稱', 'CONFLICT', 409);
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
    throw new AppError(notFound('tag'), 'NOT_FOUND', 404);
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
      throw new AppError('這個範圍內已有同名標籤，請換一個名稱', 'CONFLICT', 409);
    }
  }

  // 素材標籤存字串，改名要同步替換，否則 Tag 列變新名、素材仍是舊名，
  // 建議清單會同時出現兩個（新的來自 Tag 表、舊的來自 Material.tags）。
  if (tag.scope === 'MATERIAL' && input.name && input.name !== tag.name) {
    await renameMaterialTagString(prisma, input.tenantId, tag.name, input.name);
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
/**
 * 從所有素材的 tags 陣列移除某個標籤名稱。
 *
 * 素材標籤存在 Material.tags（String[]）而非關聯表，所以刪 Tag 列不會自動清掉——
 * 需要手動掃過帶有該字串的素材。租戶內素材量不大（數百筆級），逐筆更新可接受。
 */
async function removeMaterialTagString(
  prisma: PrismaExecutor,
  tenantId: string,
  name: string,
): Promise<void> {
  const affected = await prisma.material.findMany({
    where: { tenantId, tags: { has: name } },
    select: { id: true, tags: true },
  });
  for (const m of affected) {
    await prisma.material.update({
      where: { id: m.id },
      data: { tags: m.tags.filter((t) => t !== name) },
    });
  }
}

/** 把所有素材 tags 內的舊名稱換成新名稱（改名時保持兩邊一致）。 */
async function renameMaterialTagString(
  prisma: PrismaExecutor,
  tenantId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const affected = await prisma.material.findMany({
    where: { tenantId, tags: { has: oldName } },
    select: { id: true, tags: true },
  });
  for (const m of affected) {
    // 若素材已同時有新舊兩個名稱，換完要去重
    const next = [...new Set(m.tags.map((t) => (t === oldName ? newName : t)))];
    await prisma.material.update({ where: { id: m.id }, data: { tags: next } });
  }
}

export async function deleteTenantTag(
  prisma: TenantDb,
  tenantId: string,
  tagId: string,
) {
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, tenantId },
    select: { id: true, name: true, scope: true },
  });

  if (!tag) {
    throw new AppError(notFound('tag'), 'NOT_FOUND', 404);
  }

  await prisma.contactTag.deleteMany({ where: { tagId } });
  await prisma.caseTag.deleteMany({ where: { tagId } });
  await prisma.conversationTag.deleteMany({ where: { tagId } });

  // 素材標籤存在 Material.tags（String[]）而非關聯表，刪 Tag 列不會自動清掉。
  // 不處理的話：管理員刪了標籤，素材仍帶著那個字串，
  // 而 listMaterialTags 會併入舊字串 → 刪掉的標籤立刻又出現在建議清單。
  if (tag.scope === 'MATERIAL') {
    await removeMaterialTagString(prisma, tenantId, tag.name);
  }

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
      if (!existing) throw new AppError(notFound('contactTag'), 'NOT_FOUND', 404);
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
      if (!existing) throw new AppError(notFound('caseTag'), 'NOT_FOUND', 404);
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
      if (!existing) throw new AppError(notFound('conversationTag'), 'NOT_FOUND', 404);
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
