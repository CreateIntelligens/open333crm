/**
 * Material Service — 「使用者客製化後可重用的可發送內容」CRUD + preview + duplicate
 *
 * 自 add-line-fb-split-materials change 起：
 *   - templateId 改為選填；Material 可直接從 contentType 建立，不再強制走 fork 流程
 *   - 變數 UI 已拿掉，但資料層 variables 欄位保留供未來進階模式
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import {
  renderTemplateBody,
  buildVariableMap,
  sampleVariables,
  extractVariables,
  type TemplateVariable,
} from './template-renderer.js';
import { resolveContext } from './template-context.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface CreateMaterialInput {
  templateId?: string;
  name: string;
  description?: string;
  category?: string;
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
  body?: Record<string, unknown>;
  variables?: TemplateVariable[];
  targetChannels?: string[];
  previewImageUrl?: string;
  isActive?: boolean;
}

export interface ListMaterialsFilter {
  channelType?: string;
  category?: string;
  q?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
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

// ─── CRUD ───────────────────────────────────────────────────────────────

export async function listMaterials(
  prisma: PrismaClient,
  tenantId: string,
  filter: ListMaterialsFilter = {},
) {
  const { channelType, category, q, isActive = true, page = 1, limit = 50 } = filter;

  const where: Record<string, unknown> = { tenantId, isActive };
  if (channelType) where.channelType = channelType;
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.material.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: where as any,
      include: { template: { select: { id: true, name: true, category: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.material.count({ where: where as any }),
  ]);

  return { items, total, page, limit };
}

export async function getMaterial(prisma: PrismaClient, id: string, tenantId: string) {
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
  prisma: PrismaClient,
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

  const material = await prisma.material.create({
    data: {
      tenantId,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? template?.category ?? null,
      channelType,
      contentType,
      body: (input.body ?? (template?.body as Record<string, unknown> | undefined) ?? {}) as Prisma.InputJsonValue,
      variables: (input.variables ?? (template?.variables as unknown as TemplateVariable[] | undefined) ?? []) as unknown as Prisma.InputJsonValue,
      targetChannels: input.targetChannels ?? [],
      previewImageUrl: input.previewImageUrl ?? template?.previewImageUrl ?? null,
      createdById: input.createdById ?? null,
    },
  });

  return material;
}

export async function updateMaterial(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  input: UpdateMaterialInput,
) {
  // 先 ensure 存在且屬於本 tenant
  await getMaterial(prisma, id, tenantId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.body !== undefined) data.body = input.body;
  if (input.variables !== undefined) data.variables = input.variables;
  if (input.targetChannels !== undefined) data.targetChannels = input.targetChannels;
  if (input.previewImageUrl !== undefined) data.previewImageUrl = input.previewImageUrl;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.material.update({
    where: { id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data as any,
  });
  return updated;
}

export async function deleteMaterial(prisma: PrismaClient, id: string, tenantId: string) {
  await getMaterial(prisma, id, tenantId);
  await prisma.material.update({
    where: { id },
    data: { isActive: false },
  });
  return { deleted: true };
}

export async function duplicateMaterial(prisma: PrismaClient, id: string, tenantId: string) {
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
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  options: { contactId?: string; variables?: Record<string, string> } = {},
) {
  const material = await getMaterial(prisma, id, tenantId);

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
  prisma: PrismaClient,
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
  const renderedBody = renderTemplateBody(material.body as Record<string, unknown>, variables);

  return {
    channelType: material.channelType,
    contentType: material.contentType,
    renderedBody,
    materialId: material.id,
  };
}

// ─── Categories ─────────────────────────────────────────────────────────

export async function listMaterialCategories(prisma: PrismaClient, tenantId: string) {
  const rows = await prisma.material.findMany({
    where: { tenantId, isActive: true, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => r.category).filter(Boolean);
}
