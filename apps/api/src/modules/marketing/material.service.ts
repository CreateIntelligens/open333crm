/**
 * Material Service — 「使用者客製化後可重用的可發送內容」CRUD + preview + duplicate
 *
 * 自 add-line-fb-split-materials change 起：
 *   - templateId 改為選填；Material 可直接從 contentType 建立，不再強制走 fork 流程
 *   - 變數 UI 已拿掉，但資料層 variables 欄位保留供未來進階模式
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';
import {
  renderTemplateBody,
  buildVariableMap,
  sampleVariables,
  extractVariables,
  type TemplateVariable,
} from './template-renderer.js';
import { resolveContext } from './template-context.js';
import {
  LINE_FLEX_TEMPLATE_CONTENT_TYPE,
  LineFlexTemplateError,
  normalizeLineFlexMessageBody,
  validateLineFlexMessageBody,
  type LineFlexMessageBody,
} from '@open333crm/shared';
import { decryptCredentials } from '../channel/channel.service.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateMaterialInput {
  templateId?: string;
  name: string;
  description?: string;
  category?: string;
  categoryId?: string | null;
  tags?: string[];
  status?: string;
  channelType?: string;
  contentType?: string;
  body?: Record<string, unknown>;
  variables?: TemplateVariable[];
  targetChannels?: string[];
  previewImageUrl?: string;
  createdById?: string;
}

export interface UpdateMaterialInput {
  name?: string;
  description?: string;
  category?: string;
  categoryId?: string | null;
  tags?: string[];
  status?: string;
  body?: Record<string, unknown>;
  variables?: TemplateVariable[];
  targetChannels?: string[];
  previewImageUrl?: string;
  isActive?: boolean;
  /** 觸發版本快照的編輯者（updateMaterial 內用；createMaterial 用 createdById）。 */
  editedById?: string | null;
}

export type MaterialSort = 'recent_used' | 'most_used' | 'updated' | 'name';

export interface ListMaterialsFilter {
  channelType?: string;
  category?: string;
  categoryId?: string;
  tags?: string[];
  status?: string;
  sort?: MaterialSort;
  q?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

const MATERIAL_STATUSES = ['draft', 'approved'];

export interface ImportLineFlexMaterialInput {
  name: string;
  description?: string;
  category?: string;
  payload: unknown;
  altText?: string;
  previewImageUrl?: string;
  createdById?: string;
}

const ALLOWED_CHANNEL_TYPES = ['line', 'fb'];

function validateChannelContentTypeConsistency(channelType: string, contentType: string) {
  if (contentType.startsWith('line_') && channelType !== 'line') {
    throw new AppError(
      `contentType ${contentType} requires channelType=line`,
      'INVALID_CHANNEL_CONTENT_TYPE',
      400,
    );
  }
  if (contentType.startsWith('fb_') && channelType !== 'fb') {
    throw new AppError(
      `contentType ${contentType} requires channelType=fb`,
      'INVALID_CHANNEL_CONTENT_TYPE',
      400,
    );
  }
}

function flexErrorToAppError(error: unknown): AppError {
  if (error instanceof LineFlexTemplateError) {
    return new AppError(error.message, error.code, 400);
  }
  if (error instanceof AppError) return error;
  return new AppError(
    error instanceof Error ? error.message : 'Invalid LINE Flex template',
    'INVALID_LINE_FLEX_TEMPLATE',
    400,
  );
}

function assertLineFlexMessageBody(body: unknown): LineFlexMessageBody {
  const normalized = normalizeLineFlexMessageBody(body);
  const result = validateLineFlexMessageBody(normalized);
  if (!result.valid) {
    const first = result.errors[0];
    throw new AppError(first.message, first.code, 400);
  }
  return normalized;
}

function buildLineQuickReply(quickReplies: unknown) {
  if (!Array.isArray(quickReplies) || quickReplies.length === 0) return undefined;
  return {
    items: quickReplies.map((reply) => {
      const item = reply as Record<string, unknown>;
      const label = typeof item.label === 'string' ? item.label : '';
      const text = typeof item.text === 'string' ? item.text : undefined;
      const postbackData = typeof item.postbackData === 'string' ? item.postbackData : undefined;
      const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl : undefined;
      return {
        type: 'action',
        ...(imageUrl ? { imageUrl } : {}),
        action: postbackData
          ? { type: 'postback', label, data: postbackData, displayText: text }
          : { type: 'message', label, text: text ?? label },
      };
    }),
  };
}

function toLineFlexValidateMessage(body: LineFlexMessageBody): Record<string, unknown> {
  const quickReply = buildLineQuickReply(body.quickReplies);
  return {
    type: 'flex',
    altText: body.altText,
    contents: body.contents,
    ...(quickReply ? { quickReply } : {}),
  };
}

function formatLineValidateError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : undefined;
    const details = Array.isArray(record.details)
      ? record.details
          .map((detail) => {
            if (!detail || typeof detail !== 'object') return undefined;
            const item = detail as Record<string, unknown>;
            const property = typeof item.property === 'string' ? item.property : undefined;
            const detailMessage = typeof item.message === 'string' ? item.message : undefined;
            if (property && detailMessage) return `${property}: ${detailMessage}`;
            return detailMessage;
          })
          .filter(Boolean)
          .join('; ')
      : undefined;
    return [message, details].filter(Boolean).join(' - ') || `LINE validate API failed (${status})`;
  }
  return `LINE validate API failed (${status})`;
}

async function getLineChannelAccessToken(prisma: TenantDb, tenantId: string): Promise<string> {
  const channel = await prisma.channel.findFirst({
    where: { tenantId, channelType: 'LINE', isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { credentialsEncrypted: true },
  });
  if (!channel) {
    throw new AppError('找不到啟用中的 LINE channel，無法使用 LINE validate API', 'LINE_CHANNEL_NOT_FOUND', 400);
  }

  const credentials = decryptCredentials(channel.credentialsEncrypted);
  const token = credentials.channelAccessToken;
  if (typeof token !== 'string' || !token) {
    throw new AppError('LINE channelAccessToken 未設定，無法使用 LINE validate API', 'LINE_CHANNEL_TOKEN_MISSING', 400);
  }
  return token;
}

async function validateLineFlexMessageWithLineApi(
  prisma: TenantDb,
  tenantId: string,
  body: LineFlexMessageBody,
): Promise<void> {
  const token = await getLineChannelAccessToken(prisma, tenantId);
  const response = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [toLineFlexValidateMessage(body)],
    }),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AppError(
      formatLineValidateError(response.status, responseBody),
      'LINE_FLEX_VALIDATE_FAILED',
      400,
      {
        status: response.status,
        line: responseBody,
      },
    );
  }
}

// ─── CRUD ───────────────────────────────────────────────────────────────

export async function listMaterials(
  prisma: TenantDb,
  tenantId: string,
  filter: ListMaterialsFilter = {},
) {
  const {
    channelType, category, categoryId, tags, status, sort = 'updated',
    q, isActive = true, page = 1, limit = 50,
  } = filter;

  const where: Record<string, unknown> = { tenantId, isActive };
  if (channelType) where.channelType = channelType;
  if (category) where.category = category;
  if (categoryId) where.categoryId = categoryId;
  if (status) where.status = status;
  if (tags && tags.length > 0) where.tags = { hasSome: tags }; // 有任一標籤即命中
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  // 排序：最近使用 / 最常用 / 更新時間 / 名稱。
  // recent_used：未使用（lastUsedAt = null）排最後，故 nulls: 'last'。
  const orderBy: Record<string, unknown> =
    sort === 'recent_used' ? { lastUsedAt: { sort: 'desc', nulls: 'last' } }
    : sort === 'most_used' ? { usageCount: 'desc' }
    : sort === 'name' ? { name: 'asc' }
    : { updatedAt: 'desc' };

  const [items, total, maxUsage] = await Promise.all([
    prisma.material.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      include: {
        template: { select: { id: true, name: true, category: true } },
        materialCategory: { select: { id: true, name: true } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      orderBy: orderBy as any,
      skip: (page - 1) * limit,
      take: limit,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.material.count({ where: where as any }),
    // 用量長條正規化基準：租戶內（作用中）最大 usageCount。
    prisma.material.aggregate({
      where: { tenantId, isActive: true },
      _max: { usageCount: true },
    }),
  ]);

  return { items, total, page, limit, maxUsageCount: maxUsage._max.usageCount ?? 0 };
}

export async function getMaterial(prisma: TenantDb, id: string, tenantId: string) {
  const material = await prisma.material.findUnique({
    where: { id },
    include: { template: true },
  });
  if (!material || material.tenantId !== tenantId) {
    throw new AppError('Material not found', 'MATERIAL_NOT_FOUND', 404);
  }
  return material;
}

export async function createMaterial(
  prisma: TenantDb,
  tenantId: string,
  input: CreateMaterialInput,
) {
  // 自 add-line-fb-split-materials 起，templateId 不再必填。Material 直接從 contentType 建立。
  // 若有傳 templateId，仍會驗證其存在性並用來預填 body / variables。

  let template: Awaited<ReturnType<typeof prisma.messageTemplate.findUnique>> = null;
  if (input.templateId) {
    template = await prisma.messageTemplate.findUnique({
      where: { id: input.templateId },
    });
    if (!template) {
      throw new AppError('Source template not found', 'TEMPLATE_NOT_FOUND', 404);
    }
    if (template.tenantId !== null && template.tenantId !== tenantId) {
      throw new AppError('Source template not accessible', 'TEMPLATE_NOT_FOUND', 404);
    }
    if (!template.isActive) {
      throw new AppError('Source template is inactive', 'TEMPLATE_INACTIVE', 400);
    }
  }

  const channelType = input.channelType ?? template?.channelType;
  const contentType = input.contentType ?? template?.contentType;

  if (!channelType || !contentType) {
    throw new AppError('channelType and contentType are required when no templateId is provided', 'CHANNEL_CONTENT_REQUIRED', 400);
  }
  if (!ALLOWED_CHANNEL_TYPES.includes(channelType)) {
    throw new AppError(`channelType must be one of ${ALLOWED_CHANNEL_TYPES.join(', ')}`, 'INVALID_CHANNEL_TYPE', 400);
  }
  validateChannelContentTypeConsistency(channelType, contentType);
  let body = input.body ?? (template?.body as Record<string, unknown> | undefined) ?? {};
  let variables = input.variables ?? (template?.variables as unknown as TemplateVariable[] | undefined) ?? [];
  if (contentType === LINE_FLEX_TEMPLATE_CONTENT_TYPE) {
    body = assertLineFlexMessageBody(body) as unknown as Record<string, unknown>;
    variables = [];
  }

  if (input.status !== undefined && !MATERIAL_STATUSES.includes(input.status)) {
    throw new AppError(`status must be one of ${MATERIAL_STATUSES.join(', ')}`, 'INVALID_STATUS', 400);
  }
  if (input.categoryId) {
    await assertCategoryBelongsToTenant(prisma, input.categoryId, tenantId);
  }

  const material = await prisma.material.create({
    data: {
      tenantId,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? template?.category ?? null,
      categoryId: input.categoryId ?? null,
      tags: input.tags ?? [],
      status: input.status ?? 'draft',
      channelType,
      contentType,
      body: body as Prisma.InputJsonValue,
      variables: variables as unknown as Prisma.InputJsonValue,
      targetChannels: input.targetChannels ?? [],
      previewImageUrl: input.previewImageUrl ?? template?.previewImageUrl ?? null,
      createdById: input.createdById ?? null,
    },
  });

  // 首建即記 v1 快照（版本歷史從建立起算）。
  await writeMaterialVersion(prisma, material, input.createdById ?? null);

  return material;
}

export async function updateMaterial(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  input: UpdateMaterialInput,
) {
  // 先 ensure 存在且屬於本 tenant
  const existing = await getMaterial(prisma, id, tenantId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.categoryId !== undefined) {
    if (input.categoryId) await assertCategoryBelongsToTenant(prisma, input.categoryId, tenantId);
    data.categoryId = input.categoryId;
  }
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.status !== undefined) {
    if (!MATERIAL_STATUSES.includes(input.status)) {
      throw new AppError(`status must be one of ${MATERIAL_STATUSES.join(', ')}`, 'INVALID_STATUS', 400);
    }
    data.status = input.status;
  }
  if (input.body !== undefined) {
    data.body = existing.contentType === LINE_FLEX_TEMPLATE_CONTENT_TYPE
      ? assertLineFlexMessageBody(input.body)
      : input.body;
  }
  if (input.variables !== undefined) data.variables = input.variables;
  if (existing.contentType === LINE_FLEX_TEMPLATE_CONTENT_TYPE && input.body !== undefined) {
    data.variables = [];
  }
  if (input.targetChannels !== undefined) data.targetChannels = input.targetChannels;
  if (input.previewImageUrl !== undefined) data.previewImageUrl = input.previewImageUrl;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.material.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
  });

  // 每次編輯（name / body 有異動時）記一版快照。只改 status/tags/category 等中繼資料
  // 不算內容變更、不產版本，避免版本表被中繼欄位灌爆。
  if (input.name !== undefined || input.body !== undefined) {
    await writeMaterialVersion(prisma, updated, input.editedById ?? null);
  }
  return updated;
}

// ─── LINE Flex Template Import ──────────────────────────────────────────

export async function validateLineFlexDraft(
  prisma: TenantDb,
  tenantId: string,
  payload: unknown,
  options: { altText?: string } = {},
) {
  try {
    const body = normalizeLineFlexMessageBody(payload, { altText: options.altText });
    const validation = validateLineFlexMessageBody(body);
    if (!validation.valid) {
      const first = validation.errors[0];
      throw new AppError(first.message, first.code, 400);
    }
    await validateLineFlexMessageWithLineApi(prisma, tenantId, body);
    return { body, validation };
  } catch (error) {
    throw flexErrorToAppError(error);
  }
}

export async function importLineFlexMaterial(
  prisma: TenantDb,
  tenantId: string,
  input: ImportLineFlexMaterialInput,
) {
  try {
    const body = normalizeLineFlexMessageBody(input.payload, {
      altText: input.altText ?? input.name,
    });
    const validation = validateLineFlexMessageBody(body);
    if (!validation.valid) {
      const first = validation.errors[0];
      throw new AppError(first.message, first.code, 400);
    }

    return createMaterial(prisma, tenantId, {
      name: input.name,
      description: input.description,
      category: input.category,
      channelType: 'line',
      contentType: LINE_FLEX_TEMPLATE_CONTENT_TYPE,
      body: body as unknown as Record<string, unknown>,
      variables: [],
      previewImageUrl: input.previewImageUrl,
      createdById: input.createdById,
    });
  } catch (error) {
    throw flexErrorToAppError(error);
  }
}

export async function deleteMaterial(prisma: TenantDb, id: string, tenantId: string) {
  await getMaterial(prisma, id, tenantId);
  await prisma.material.update({
    where: { id },
    data: { isActive: false },
  });
  return { deleted: true };
}

export async function duplicateMaterial(prisma: TenantDb, id: string, tenantId: string) {
  const source = await getMaterial(prisma, id, tenantId);
  const copy = await prisma.material.create({
    data: {
      tenantId,
      templateId: source.templateId,
      name: `${source.name} (copy)`,
      description: source.description,
      category: source.category,
      channelType: source.channelType,
      contentType: source.contentType,
      body: source.body as Prisma.InputJsonValue,
      variables: source.variables as Prisma.InputJsonValue,
      targetChannels: source.targetChannels,
      previewImageUrl: source.previewImageUrl,
      createdById: source.createdById,
    },
  });
  return copy;
}

// ─── Preview & Send Helpers ─────────────────────────────────────────────

export async function previewMaterial(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  options: { contactId?: string; variables?: Record<string, string> } = {},
) {
  const material = await getMaterial(prisma, id, tenantId);
  if (material.contentType === LINE_FLEX_TEMPLATE_CONTENT_TYPE) {
    const rendered = assertLineFlexMessageBody(material.body);
    return {
      material: {
        id: material.id,
        name: material.name,
        channelType: material.channelType,
        contentType: material.contentType,
      },
      rendered,
      variables: {},
      detectedKeys: [],
    };
  }

  const definedVars = (material.variables as unknown as TemplateVariable[]) ?? [];
  const detectedKeys = extractVariables(material.body);

  // 變數來源：context（若有 contactId）→ defaults → 使用者提供 → sample fallback
  const contextValues = options.contactId
    ? await resolveContext(prisma, { contactId: options.contactId })
    : {};

  const provided: Record<string, string> = { ...contextValues, ...(options.variables ?? {}) };
  const variables = buildVariableMap(definedVars, provided);

  // 任何在 body 內出現但沒提供值的 key，用 sample 補
  const samples = sampleVariables(detectedKeys);
  for (const k of detectedKeys) {
    if (variables[k] === undefined) variables[k] = samples[k];
  }

  const rendered = renderTemplateBody(material.body as Record<string, unknown>, variables);

  return {
    material: {
      id: material.id,
      name: material.name,
      channelType: material.channelType,
      contentType: material.contentType,
    },
    rendered,
    variables,
    detectedKeys,
  };
}

/**
 * 給 Louis 接手發送整合用的接口：取得 Material + per-recipient 渲染好的 body
 * 回傳 channelType / contentType / renderedBody，呼叫端可直接交給 channel plugin sendMessage。
 */
export async function getMaterialForSend(
  prisma: TenantDb,
  materialId: string,
  tenantId: string,
  options: { contactId?: string; variables?: Record<string, string> } = {},
) {
  const material = await getMaterial(prisma, materialId, tenantId);
  if (!material.isActive) {
    throw new AppError('Material is inactive', 'MATERIAL_INACTIVE', 400);
  }

  const definedVars = (material.variables as unknown as TemplateVariable[]) ?? [];
  const contextValues = options.contactId
    ? await resolveContext(prisma, { contactId: options.contactId })
    : {};
  const provided = { ...contextValues, ...(options.variables ?? {}) };
  const variables = buildVariableMap(definedVars, provided);
  if (material.contentType === LINE_FLEX_TEMPLATE_CONTENT_TYPE) {
    return {
      channelType: material.channelType,
      contentType: material.contentType,
      renderedBody: assertLineFlexMessageBody(material.body) as unknown as Record<string, unknown>,
      materialId: material.id,
    };
  }
  const renderedBody = renderTemplateBody(material.body as Record<string, unknown>, variables);

  return {
    channelType: material.channelType,
    contentType: material.contentType,
    renderedBody,
    materialId: material.id,
  };
}

// ─── Legacy string categories（過渡保留，前端已改用分類樹） ──────────────

export async function listMaterialCategories(prisma: TenantDb, tenantId: string) {
  const rows = await prisma.material.findMany({
    where: { tenantId, isActive: true, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => r.category).filter(Boolean);
}

// ─── Governance: Version snapshot helpers ───────────────────────────────

/** 寫一筆版本快照：versionNo = 該素材現有最大版號 + 1（首建為 1）。 */
async function writeMaterialVersion(
  prisma: TenantDb,
  material: { id: string; tenantId: string; name: string; body: unknown },
  editedById: string | null,
) {
  const last = await prisma.materialVersion.findFirst({
    where: { materialId: material.id },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true },
  });
  const nextNo = (last?.versionNo ?? 0) + 1;
  await prisma.materialVersion.create({
    data: {
      tenantId: material.tenantId,
      materialId: material.id,
      versionNo: nextNo,
      name: material.name,
      body: material.body as Prisma.InputJsonValue,
      editedById,
    },
  });
}

/** 確認分類存在且屬於本租戶（RLS 已擋跨租戶，這裡再給明確 404）。 */
async function assertCategoryBelongsToTenant(prisma: TenantDb, categoryId: string, tenantId: string) {
  const cat = await prisma.materialCategory.findUnique({ where: { id: categoryId } });
  if (!cat || cat.tenantId !== tenantId) {
    throw new AppError('Category not found', 'CATEGORY_NOT_FOUND', 404);
  }
  return cat;
}

// ─── Governance: Category tree CRUD ─────────────────────────────────────

/** 回傳租戶分類樹（含每分類的作用中素材數）。單層 parent→child 呈現。 */
export async function listMaterialCategoryTree(prisma: TenantDb, tenantId: string) {
  const [cats, counts] = await Promise.all([
    prisma.materialCategory.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    // groupBy 在 TenantDb union 型別下 TS 報 union-not-callable（見 RLS skill 陷阱 #3）；
    // 局部 cast，執行期仍走 RLS 綁定。
    (prisma.material as PrismaClient['material']).groupBy({
      by: ['categoryId'],
      where: { tenantId, isActive: true, categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map(
    counts.map((c: { categoryId: string | null; _count: { _all: number } }) => [c.categoryId, c._count._all]),
  );
  return cats.map((c) => ({ ...c, materialCount: countMap.get(c.id) ?? 0 }));
}

export async function createMaterialCategory(
  prisma: TenantDb,
  tenantId: string,
  input: { name: string; parentId?: string | null; sortOrder?: number },
) {
  if (input.parentId) {
    await assertCategoryBelongsToTenant(prisma, input.parentId, tenantId);
  }
  return prisma.materialCategory.create({
    data: {
      tenantId,
      name: input.name,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateMaterialCategory(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  input: { name?: string; parentId?: string | null; sortOrder?: number },
) {
  await assertCategoryBelongsToTenant(prisma, id, tenantId);

  // 搬移：擋自我循環（不可把分類移到自己或自己的子孫下）。
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === id) {
      throw new AppError('分類不可移到自己底下', 'CATEGORY_CYCLE', 400);
    }
    await assertCategoryBelongsToTenant(prisma, input.parentId, tenantId);
    const descendants = await collectDescendantIds(prisma, tenantId, id);
    if (descendants.has(input.parentId)) {
      throw new AppError('分類不可移到自己的子分類底下', 'CATEGORY_CYCLE', 400);
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.parentId !== undefined) data.parentId = input.parentId;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  return prisma.materialCategory.update({ where: { id }, data: data as Prisma.MaterialCategoryUpdateInput });
}

/** 蒐集某分類的所有子孫 id（BFS）。租戶內全撈避免多次查詢。 */
async function collectDescendantIds(prisma: TenantDb, tenantId: string, rootId: string): Promise<Set<string>> {
  const all = await prisma.materialCategory.findMany({
    where: { tenantId },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string, string[]>();
  for (const c of all) {
    if (!c.parentId) continue;
    const arr = childrenOf.get(c.parentId) ?? [];
    arr.push(c.id);
    childrenOf.set(c.parentId, arr);
  }
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (!out.has(child)) { out.add(child); queue.push(child); }
    }
  }
  return out;
}

/** 刪分類：其下素材 categoryId 由 FK ON DELETE SET NULL 自動歸零（不刪素材）。 */
export async function deleteMaterialCategory(prisma: TenantDb, id: string, tenantId: string) {
  await assertCategoryBelongsToTenant(prisma, id, tenantId);
  await prisma.materialCategory.delete({ where: { id } });
  return { deleted: true };
}

// ─── Governance: Tags ───────────────────────────────────────────────────

/** 聚合租戶所有作用中素材的 distinct 標籤（無標籤表，即時彙總）。 */
export async function listMaterialTags(prisma: TenantDb, tenantId: string): Promise<string[]> {
  const rows = await prisma.material.findMany({
    where: { tenantId, isActive: true },
    select: { tags: true },
  });
  const set = new Set<string>();
  for (const r of rows) for (const t of r.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ─── Governance: Version history & restore ──────────────────────────────

export async function listMaterialVersions(prisma: TenantDb, materialId: string, tenantId: string) {
  await getMaterial(prisma, materialId, tenantId); // ensure 屬本租戶
  return prisma.materialVersion.findMany({
    where: { materialId },
    orderBy: { versionNo: 'desc' },
  });
}

/**
 * 還原到指定版本：把該版 name/body 寫回 Material，並產生一個新版（還原＝一次新編輯，
 * 線性歷史不破壞）。
 */
export async function restoreMaterialVersion(
  prisma: TenantDb,
  materialId: string,
  versionNo: number,
  tenantId: string,
  editedById: string | null,
) {
  const material = await getMaterial(prisma, materialId, tenantId);
  const version = await prisma.materialVersion.findUnique({
    where: { materialId_versionNo: { materialId, versionNo } },
  });
  if (!version) {
    throw new AppError('Version not found', 'VERSION_NOT_FOUND', 404);
  }
  const updated = await prisma.material.update({
    where: { id: materialId },
    data: {
      name: version.name,
      body: version.body as Prisma.InputJsonValue,
    },
  });
  // 還原本身記為新版（快照的是還原後＝該舊版的內容）。
  await writeMaterialVersion(prisma, updated, editedById);
  return updated;
}

// ─── Governance: Per-material performance stats ─────────────────────────

/**
 * 素材成效：使用次數 / 最後使用 / 回覆數 / 開案數（由 BroadcastRecipient 歸因回素材）。
 * 點擊率若無歸因資料（無短連結）回 null，UI 顯示「暫無資料」而非 0。
 */
export async function getMaterialStats(prisma: TenantDb, materialId: string, tenantId: string) {
  const material = await getMaterial(prisma, materialId, tenantId);

  // 該素材的所有廣播 → 其 recipients 的 replied / caseId 聚合。
  const broadcasts = await prisma.broadcast.findMany({
    where: { materialId, tenantId },
    select: { id: true },
  });
  const broadcastIds = broadcasts.map((b) => b.id);

  let replyCount = 0;
  let casesOpened = 0;
  if (broadcastIds.length > 0) {
    [replyCount, casesOpened] = await Promise.all([
      prisma.broadcastRecipient.count({ where: { broadcastId: { in: broadcastIds }, replied: true } }),
      prisma.broadcastRecipient.count({ where: { broadcastId: { in: broadcastIds }, caseId: { not: null } } }),
    ]);
  }

  return {
    materialId,
    usageCount: material.usageCount,
    lastUsedAt: material.lastUsedAt,
    replyCount,
    casesOpened,
    // 點擊率：目前無短連結層級歸因資料 → null（UI 顯示「暫無資料」）。
    clickThroughRate: null as number | null,
  };
}
