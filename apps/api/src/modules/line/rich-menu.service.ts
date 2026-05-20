/**
 * Rich Menu 草稿管理 service
 *
 * 本期只做 CRUD：
 *   - status 一律 draft（更新 / 刪除前 service 層強制驗證）
 *   - 未來 publish 流程接手時，會擴 status 到 published / error
 *
 * 與 LINE API 互動（POST richmenu / 上傳圖檔 / set default 等）由後續迭代負責。
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../../shared/utils/response.js';
import { isValidRichMenuSize } from './rich-menu.layouts.js';

// ─── Types ─────────────────────────────────────────────────────────────

type ActionType = 'postback' | 'message' | 'uri' | 'datetimepicker' | 'richmenuswitch';

interface RichMenuAction {
  type: ActionType;
  // 共用欄位
  label?: string;
  // postback
  data?: string;
  displayText?: string;
  // message
  text?: string;
  // uri
  uri?: string;
  altUri?: { desktop?: string };
  // datetimepicker
  mode?: 'date' | 'time' | 'datetime';
  initial?: string;
  min?: string;
  max?: string;
  // richmenuswitch
  richMenuAliasId?: string;
}

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: RichMenuAction;
}

export interface CreateRichMenuInput {
  channelId: string;
  name: string;
  chatBarText: string;
  size: { width: number; height: number };
  selected?: boolean;
  areas: RichMenuArea[];
  imageUrl: string;
}

export interface UpdateRichMenuInput {
  name?: string;
  chatBarText?: string;
  size?: { width: number; height: number };
  selected?: boolean;
  areas?: RichMenuArea[];
  imageUrl?: string;
}

// ─── Validation helpers ────────────────────────────────────────────────

function validateChatBarText(text: string): void {
  if (text.length === 0) throw new AppError('chatBarText is required', 'INVALID_INPUT', 400);
  if (text.length > 14) throw new AppError('chatBarText must be at most 14 characters', 'INVALID_INPUT', 400);
}

function validateAction(action: RichMenuAction): void {
  if (!action || !action.type) {
    throw new AppError('Action type is required', 'INVALID_ACTION', 400);
  }
  switch (action.type) {
    case 'postback':
      if (!action.data) throw new AppError('postback action requires data', 'INVALID_ACTION', 400);
      if (action.data.length > 300) throw new AppError('postback data ≤ 300 chars', 'INVALID_ACTION', 400);
      if (action.label && action.label.length > 20) throw new AppError('label ≤ 20 chars', 'INVALID_ACTION', 400);
      if (action.displayText && action.displayText.length > 300) throw new AppError('displayText ≤ 300 chars', 'INVALID_ACTION', 400);
      break;
    case 'message':
      if (!action.text) throw new AppError('message action requires text', 'INVALID_ACTION', 400);
      if (action.text.length > 300) throw new AppError('message text ≤ 300 chars', 'INVALID_ACTION', 400);
      break;
    case 'uri':
      if (!action.uri) throw new AppError('uri action requires uri', 'INVALID_ACTION', 400);
      break;
    case 'datetimepicker':
      if (!action.data) throw new AppError('datetimepicker requires data', 'INVALID_ACTION', 400);
      if (!action.mode) throw new AppError('datetimepicker requires mode', 'INVALID_ACTION', 400);
      if (!['date', 'time', 'datetime'].includes(action.mode)) {
        throw new AppError('datetimepicker mode must be date/time/datetime', 'INVALID_ACTION', 400);
      }
      break;
    case 'richmenuswitch':
      if (!action.richMenuAliasId) throw new AppError('richmenuswitch requires richMenuAliasId', 'INVALID_ACTION', 400);
      if (!action.data) throw new AppError('richmenuswitch requires data', 'INVALID_ACTION', 400);
      break;
    default:
      throw new AppError(`Unsupported action type: ${(action as { type: string }).type}`, 'INVALID_ACTION', 400);
  }
}

function validateAreas(areas: RichMenuArea[], size: { width: number; height: number }): void {
  if (!Array.isArray(areas) || areas.length === 0) {
    throw new AppError('At least one area is required', 'INVALID_INPUT', 400);
  }
  if (areas.length > 20) {
    throw new AppError('Up to 20 areas allowed', 'INVALID_INPUT', 400);
  }
  for (const [i, area] of areas.entries()) {
    if (!area.bounds || typeof area.bounds.x !== 'number' || typeof area.bounds.y !== 'number'
      || typeof area.bounds.width !== 'number' || typeof area.bounds.height !== 'number') {
      throw new AppError(`Area #${i + 1} bounds malformed`, 'INVALID_INPUT', 400);
    }
    const { x, y, width, height } = area.bounds;
    if (x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new AppError(`Area #${i + 1} bounds must be positive`, 'INVALID_INPUT', 400);
    }
    if (x + width > size.width || y + height > size.height) {
      throw new AppError(`Area #${i + 1} exceeds image size`, 'INVALID_INPUT', 400);
    }
    validateAction(area.action);
  }
}

async function assertChannelBelongsToTenant(
  prisma: PrismaClient,
  channelId: string,
  tenantId: string,
): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, tenantId },
  });
  if (!channel) {
    // 不洩露 channel 存在性，回 404
    throw new AppError('Channel not found', 'NOT_FOUND', 404);
  }
  if (channel.channelType !== 'LINE') {
    throw new AppError('Rich Menu is only supported on LINE channels', 'INVALID_CHANNEL_TYPE', 400);
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function listRichMenus(
  prisma: PrismaClient,
  tenantId: string,
  channelId: string,
) {
  await assertChannelBelongsToTenant(prisma, channelId, tenantId);
  return prisma.richMenu.findMany({
    where: { tenantId, channelId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const menu = await prisma.richMenu.findFirst({ where: { id, tenantId } });
  if (!menu) throw new AppError('Rich Menu not found', 'NOT_FOUND', 404);
  return menu;
}

export async function createRichMenu(
  prisma: PrismaClient,
  tenantId: string,
  input: CreateRichMenuInput,
) {
  await assertChannelBelongsToTenant(prisma, input.channelId, tenantId);
  validateChatBarText(input.chatBarText);

  if (!isValidRichMenuSize(input.size)) {
    throw new AppError(
      'Invalid layout size; must be 2500×1686 or 2500×843',
      'INVALID_LAYOUT',
      400,
    );
  }
  validateAreas(input.areas, input.size);

  if (!input.imageUrl) {
    throw new AppError('imageUrl is required', 'INVALID_INPUT', 400);
  }

  return prisma.richMenu.create({
    data: {
      tenantId,
      channelId: input.channelId,
      name: input.name,
      chatBarText: input.chatBarText,
      size: input.size as unknown as Prisma.InputJsonValue,
      selected: input.selected ?? false,
      areas: input.areas as unknown as Prisma.InputJsonValue,
      imageUrl: input.imageUrl,
      status: 'draft',
    },
  });
}

export async function updateRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
  input: UpdateRichMenuInput,
) {
  const existing = await getRichMenu(prisma, id, tenantId);

  // 守衛：本期僅允許 draft 狀態被修改
  if (existing.status !== 'draft') {
    throw new AppError(
      'Only draft rich menus can be updated; un-publish first',
      'INVALID_STATUS',
      400,
    );
  }

  // 取出新或舊的 size，用於驗證 areas
  const finalSize = (input.size ?? (existing.size as { width: number; height: number }));
  if (input.size && !isValidRichMenuSize(input.size)) {
    throw new AppError('Invalid layout size', 'INVALID_LAYOUT', 400);
  }
  if (input.areas) {
    validateAreas(input.areas, finalSize);
  }
  if (input.chatBarText !== undefined) {
    validateChatBarText(input.chatBarText);
  }

  const data: Prisma.RichMenuUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.chatBarText !== undefined) data.chatBarText = input.chatBarText;
  if (input.size !== undefined) data.size = input.size as unknown as Prisma.InputJsonValue;
  if (input.selected !== undefined) data.selected = input.selected;
  if (input.areas !== undefined) data.areas = input.areas as unknown as Prisma.InputJsonValue;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;

  return prisma.richMenu.update({ where: { id }, data });
}

export async function deleteRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const existing = await getRichMenu(prisma, id, tenantId);
  if (existing.status !== 'draft') {
    throw new AppError(
      'Cannot delete a published rich menu; un-publish first',
      'CANNOT_DELETE_PUBLISHED',
      400,
    );
  }
  await prisma.richMenu.delete({ where: { id } });
  return { deleted: true };
}

export async function duplicateRichMenu(
  prisma: PrismaClient,
  id: string,
  tenantId: string,
) {
  const source = await getRichMenu(prisma, id, tenantId);
  return prisma.richMenu.create({
    data: {
      tenantId,
      channelId: source.channelId,
      name: `${source.name}（副本）`,
      chatBarText: source.chatBarText,
      size: source.size as unknown as Prisma.InputJsonValue,
      selected: source.selected,
      areas: source.areas as unknown as Prisma.InputJsonValue,
      imageUrl: source.imageUrl,
      status: 'draft',
    },
  });
}
