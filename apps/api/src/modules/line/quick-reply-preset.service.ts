/**
 * Quick Reply Preset service — 客服可重用的快速回覆按鈕組。
 * Tenant-scoped；不綁定特定 channel（所有 LINE channel 共用同一組 preset）。
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { TenantDb } from '../../lib/tenant-db.js';
import { AppError } from '../../shared/utils/response.js';

export interface QuickReplyItem {
  label: string;
  text?: string;
}

export interface CreatePresetInput {
  name: string;
  items: QuickReplyItem[];
}

export interface UpdatePresetInput {
  name?: string;
  items?: QuickReplyItem[];
  isActive?: boolean;
}

// LINE 規格：≤ 13 個 item；label ≤ 20 chars；text ≤ 300 chars
function validateItems(items: QuickReplyItem[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('至少需要 1 個按鈕', 'INVALID_INPUT', 400);
  }
  if (items.length > 13) {
    throw new AppError('最多 13 個按鈕（LINE 限制）', 'INVALID_INPUT', 400);
  }
  for (const [i, it] of items.entries()) {
    if (!it.label || typeof it.label !== 'string' || it.label.length === 0) {
      throw new AppError(`第 ${i + 1} 個按鈕缺少 label`, 'INVALID_INPUT', 400);
    }
    if (it.label.length > 20) {
      throw new AppError(`第 ${i + 1} 個按鈕 label 超過 20 字`, 'INVALID_INPUT', 400);
    }
    if (it.text !== undefined && it.text !== null) {
      if (typeof it.text !== 'string') {
        throw new AppError(`第 ${i + 1} 個按鈕 text 格式錯誤`, 'INVALID_INPUT', 400);
      }
      if (it.text.length > 300) {
        throw new AppError(`第 ${i + 1} 個按鈕 text 超過 300 字`, 'INVALID_INPUT', 400);
      }
    }
  }
}

function validateName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new AppError('名稱不能為空', 'INVALID_INPUT', 400);
  }
  if (name.trim().length > 100) {
    throw new AppError('名稱不能超過 100 字', 'INVALID_INPUT', 400);
  }
}

export async function listPresets(prisma: TenantDb, tenantId: string) {
  return prisma.quickReplyPreset.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPreset(prisma: TenantDb, id: string, tenantId: string) {
  const preset = await prisma.quickReplyPreset.findFirst({ where: { id, tenantId } });
  if (!preset) throw new AppError('預設組不存在', 'NOT_FOUND', 404);
  return preset;
}

export async function createPreset(
  prisma: TenantDb,
  tenantId: string,
  input: CreatePresetInput,
) {
  validateName(input.name);
  validateItems(input.items);
  return prisma.quickReplyPreset.create({
    data: {
      tenantId,
      name: input.name.trim(),
      items: input.items as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function updatePreset(
  prisma: TenantDb,
  id: string,
  tenantId: string,
  input: UpdatePresetInput,
) {
  await getPreset(prisma, id, tenantId);
  if (input.name !== undefined) validateName(input.name);
  if (input.items !== undefined) validateItems(input.items);

  const data: Prisma.QuickReplyPresetUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.items !== undefined) data.items = input.items as unknown as Prisma.InputJsonValue;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma.quickReplyPreset.update({ where: { id }, data });
}

export async function deletePreset(prisma: TenantDb, id: string, tenantId: string) {
  await getPreset(prisma, id, tenantId);
  await prisma.quickReplyPreset.delete({ where: { id } });
  return { deleted: true };
}
