import type { Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import type { TenantCtx } from '../../lib/tenant-ctx.js';
import { notFound } from '../../shared/messages/resource.js';

/**
 * 標籤與貼標（#337 階段 3）：每個函式收 TenantCtx，租戶取自 ctx.tenantId。
 * 本檔不發事件：聯絡人貼標的 contact.tagged 由呼叫端的 flow 以 publishContactTagged() 送出（tag-effects.ts）。
 */

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

export interface TargetInput {
  targetType: TagTargetType;
  targetId: string;
}

/** 貼標來源：人工 / 短連結點擊 / 自動化規則。影響 addedBy 與 contact.tagged 的 source（迴圈防護用）。 */
export type TagSource = 'agent' | 'system' | 'automation';

/** 這次貼上的聯絡人標籤。service 回傳它，flow 用它送出 contact.tagged（tag-effects.ts） */
export interface ContactTagged {
  contactId: string;
  tagId: string;
  tagName: string;
  /** 自動化以 source 防止迴圈：automation 規則貼的標籤不再觸發規則 */
  source: TagSource;
}

export interface AddTagInput extends TargetInput {
  tagId: string;
  /** 人工路徑帶操作者；非人工路徑（system/automation）可省略。 */
  agentId?: string;
  /** 預設 'agent'（既有人工呼叫者不受影響）。 */
  addedBy?: TagSource;
  /**
   * 時效標籤的到期時間。到期後由 `filterActiveContactTags` 視為不存在，
   * 並由排程清理實體列。未給則為永久標籤（既有行為不變）。
   */
  expiresAt?: Date | null;
}

export interface RemoveTagInput extends TargetInput {
  tagId: string;
}

export interface CreateTagInput {
  name: string;
  color: string;
  type: TagKind;
  scope: TagScopeType;
  description?: string;
}

export interface UpdateTagInput {
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
  { tx: prisma, tenantId }: TenantCtx,
  { targetType, targetId }: TargetInput,
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

async function getTenantTag({ tx: prisma, tenantId }: TenantCtx, tagId: string) {
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

/**
 * 貼標（重複貼標不新增資料列）。回傳的 assignment.tag 帶標籤名稱，
 * 呼叫端貼聯絡人標籤時用它送出 contact.tagged。
 */
export async function addTagToTarget(ctx: TenantCtx, input: AddTagInput) {
  const prisma = ctx.tx;
  await assertTargetExists(ctx, input);
  const tag = await getTenantTag(ctx, input.tagId);
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
        // 重複貼標時刷新效期：續期比「已存在就不動」更符合預期
        update: input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {},
        create: {
          contactId: input.targetId,
          tagId: input.tagId,
          addedBy: source,
          addedById: input.agentId ?? null,
          expiresAt: input.expiresAt ?? null,
        },
        include: { tag: { select: TAG_SELECT } },
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

/** 標籤管理頁：依範圍、名稱排序 */
export async function listTenantTags({ tx, tenantId }: TenantCtx) {
  return tx.tag.findMany({
    where: { tenantId },
    orderBy: [{ scope: 'asc' }, { name: 'asc' }],
  });
}

export async function createTenantTag({ tx: prisma, tenantId }: TenantCtx, input: CreateTagInput) {
  const duplicate = await prisma.tag.findFirst({
    where: {
      tenantId,
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
      tenantId,
      name: input.name,
      color: input.color,
      type: input.type,
      scope: input.scope,
      description: input.description,
    },
  });
}

export async function updateTenantTag(ctx: TenantCtx, tagId: string, input: UpdateTagInput) {
  const { tx: prisma, tenantId } = ctx;
  const tag = await prisma.tag.findFirst({
    where: { id: tagId, tenantId },
  });

  if (!tag) {
    throw new AppError(notFound('tag'), 'NOT_FOUND', 404);
  }

  if (input.name && input.name !== tag.name) {
    const duplicate = await prisma.tag.findFirst({
      where: {
        tenantId,
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
    await renameMaterialTagString(ctx, tag.name, input.name);
  }

  return prisma.tag.update({
    where: { id: tagId },
    data: {
      name: input.name,
      color: input.color,
      description: input.description,
    },
  });
}

/**
 * 從所有素材的 tags 陣列移除某個標籤名稱。
 *
 * 素材標籤存在 Material.tags（String[]）而非關聯表，所以刪 Tag 列不會自動清掉——
 * 需要手動掃過帶有該字串的素材。租戶內素材量不大（數百筆級），逐筆更新可接受。
 */
async function removeMaterialTagString({ tx: prisma, tenantId }: TenantCtx, name: string): Promise<void> {
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
  { tx: prisma, tenantId }: TenantCtx,
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

/** 刪除標籤與它的所有貼標。在同一個交易內依序刪除，所以是原子的 */
export async function deleteTenantTag(ctx: TenantCtx, tagId: string) {
  const { tx: prisma, tenantId } = ctx;
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
    await removeMaterialTagString(ctx, tag.name);
  }

  await prisma.tag.delete({ where: { id: tagId } });

  return { deleted: true };
}

export async function removeTagFromTarget(ctx: TenantCtx, input: RemoveTagInput) {
  const prisma = ctx.tx;
  await assertTargetExists(ctx, input);
  const tag = await getTenantTag(ctx, input.tagId);
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

export async function listTargetTags(ctx: TenantCtx, input: TargetInput) {
  const prisma = ctx.tx;
  await assertTargetExists(ctx, input);

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
