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

async function getLineChannelAccessToken(prisma: PrismaClient, tenantId: string): Promise<string> {
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
  prisma: PrismaClient,
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
  let body = input.body ?? (template?.body as Record<string, unknown> | undefined) ?? {};
  let variables = input.variables ?? (template?.variables as unknown as TemplateVariable[] | undefined) ?? [];
  if (contentType === LINE_FLEX_TEMPLATE_CONTENT_TYPE) {
    body = assertLineFlexMessageBody(body) as unknown as Record<string, unknown>;
    variables = [];
  }

  const material = await prisma.material.create({
    data: {
      tenantId,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? template?.category ?? null,
      channelType,
      contentType,
      body: body as Prisma.InputJsonValue,
      variables: variables as unknown as Prisma.InputJsonValue,
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
  const existing = await getMaterial(prisma, id, tenantId);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
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
  return updated;
}

// ─── LINE Flex Template Import ──────────────────────────────────────────

export async function validateLineFlexDraft(
  prisma: PrismaClient,
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
  prisma: PrismaClient,
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
